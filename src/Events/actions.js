import vm from 'vm';
import axios from "axios";

// Updated regex to include language and new format
const batchRegex = /(?:writeFile\s+([^\s]+)\s*```(\w+)\s*([\s\S]*?)```|``javascript\s*([\s\S]*?)\s*``|\/?(googleSearch|webpageToText|viewImage|metaAction|suggestion|jobCompleted|jobFailed)\(([^()]*)\))/g;

function detectLazyOutput(text) {
    return text.split('\n').some(line => {
        const commentContent = line.trim().substring(2).trim().toLowerCase();
        return line.trim().startsWith('//') && ['...', 'same'].some(pattern => commentContent.includes(pattern));
    });
}

export const getActions = (meta) => [
    [batchRegex, async (match, event) => {
        // Get the full message content
        const lastMessage = event.payload.messages[event.payload.messages.length - 1].content;
        let disableAutoCallback = meta?._meta_actions?.includes('REQUEST_CHAT_MODEL_EXCEEDED')
        // Find all blocks and commands in order
        let blocks = Array.from(lastMessage.matchAll(batchRegex))
            .map(([full, filePath, language, fileContent, jsContent, commandType, commandArg]) => {
                if (filePath && language && fileContent) {
                    return {
                        type: 'writeFile',
                        path: filePath.trim(),
                        language: language.trim(),
                        content: fileContent.trim()
                    };
                } else if (jsContent) {
                    return {
                        type: 'javascript',
                        content: jsContent.trim()
                    };
                } else if (commandType) {
                    if (commandType === 'suggestion') {
                        // require human confirmation
                        meta._meta_actions = meta._meta_actions.filter(action => action !== 'REQUEST_CHAT_MODEL');
                        disableAutoCallback = true;
                    }

                    if (commandArg?.startsWith('"') && commandArg?.endsWith('"')) {
                        commandArg = commandArg.slice(1, -1); // remove quotes if any
                    }

                    let arg = commandArg.trim();
                    let isJSON = false;

                    // Attempt to parse the argument as JSON
                    try {
                        arg = JSON.parse(commandArg);
                        isJSON = true;
                    } catch (e) {
                        // Argument is not JSON; proceed with the trimmed string
                    }

                    return {
                        type: commandType,
                        arg: arg
                    };
                }
            });

        // Filter out all execute_and_callback except the last one
        const lastExecuteCallback = blocks.findLast(
            block => block?.type === 'metaAction' && block?.arg === 'execute_and_callback'
        );

        blocks = [
            ...blocks.filter(block => !(block?.type === 'metaAction' && block?.arg === 'execute_and_callback')),
            ...(lastExecuteCallback ? [lastExecuteCallback] : [])
        ];

        if (blocks.length === 0) {
            return {
                error: "No valid blocks or commands found",
                ...meta
            };
        }

        try {
            // Process blocks sequentially in order
            const results = [];
            let stop;
            for (const block of blocks) {
                if (stop) break;
                if (block.type === 'writeFile' && detectLazyOutput(block.content)) {
                    results.push({
                        type: 'writeFile',
                        path: block.path,
                        success: false,
                        error: `Lazy comment detected in writeFile block, please provide complete source code for path: ${block.path}`
                    });
                    continue; // Skip processing this block further to avoid saving broken code
                }

                const url = '{{secrets.wpUrl}}';
                const headers = { 'WP-API-KEY': '{{secrets.wpapiKey}}' };

                const handleJobFinished = async (block, url, headers, results) => {
                    const { arg: data } = block;
                    const { post_id, message } = data;

                    const encryptedTitle = await openkbs.encrypt(message);

                    const promises = [
                        openkbs.chats({
                            action: "updateChat",
                            title: encryptedTitle,
                            chatIcon: block?.type === 'jobCompleted' ? '🟢' : '🔴',
                            chatId: event?.payload?.chatId
                        })
                    ];

                    if (post_id) {
                        promises.push(
                            axios.post(`${url}/wp-json/openkbs/v1/callback`, { post_id, message, type: "reload" }, { headers })
                        );
                    }

                    await Promise.all(promises);

                    results.push({ type: block.type, success: true, data });
                };

                switch (block.type) {
                    case 'writeFile': {
                        const fsUrl = `${url}/wp-json/openkbs/v1/filesystem`;

                        const response = await axios.post(
                            `${fsUrl}/write`,
                            { path: block.path, content: block.content },
                            { headers }
                        );

                        results.push({
                            type: 'writeFile',
                            path: block.path,
                            language: block.language,
                            success: response.status === 200
                        });
                        break;
                    }

                    case 'javascript': {
                        let sourceCode = block.content
                            .replace(`\{\{secrets.wpapiKey\}\}`, '{{secrets.wpapiKey}}')
                            .replace(`\{\{secrets.wpUrl\}\}`, '{{secrets.wpUrl}}');

                        // Add the export statement if it's not already present
                        if (!sourceCode.includes('module.exports')) sourceCode += '\nmodule.exports = { handler };'

                        const script = new vm.Script(sourceCode);
                        const context = {
                            require: (id) => rootContext.require(id),
                            ...rootContext,
                            console,
                            module: { exports: {} }
                        };
                        vm.createContext(context);
                        script.runInContext(context);
                        const { handler } = context.module.exports;
                        const data = await handler();

                        results.push({
                            type: 'javascript',
                            success: !data?.error,
                            data
                        });
                        break;
                    }

                    case 'googleSearch': {
                        const noSecrets = '{{secrets.googlesearch_api_key}}'.includes('secrets.googlesearch_api_key');
                        const params = {
                            q: block.arg,
                            ...(noSecrets ? {} : {
                                key: '{{secrets.googlesearch_api_key}}',
                                cx: '{{secrets.googlesearch_engine_id}}'
                            })
                        };
                        const response = noSecrets
                            ? await openkbs.googleSearch(params.q, params)
                            : (await axios.get('https://www.googleapis.com/customsearch/v1', { params }))?.data?.items;
                        const data = response?.map(({ title, link, snippet, pagemap }) => ({
                            title, link, snippet, image: pagemap?.metatags?.[0]?.["og:image"]
                        }));

                        results.push({
                            type: 'googleSearch',
                            success: !!data?.length,
                            data: data || { error: "No results found" }
                        });
                        break;
                    }

                    case 'webpageToText': {
                        const response = await openkbs.webpageToText(block.arg);
                        if (response?.content?.length > 5000) {
                            response.content = response.content.substring(0, 5000);
                        }

                        results.push({
                            type: 'webpageToText',
                            success: !!response?.url,
                            data: response?.url ? response : { error: "Unable to read website" }
                        });
                        break;
                    }

                    case 'viewImage': {
                        results.push({
                            type: 'viewImage',
                            success: true,
                            data: [
                                { type: "text", text: "Image URL: " + block.arg },
                                { type: "image_url", image_url: { url: block.arg } }
                            ]
                        });
                        break;
                    }

                    case 'metaAction': {
                        stop = true; // always last command
                        if (block.arg === 'execute_and_callback') {
                            if (!disableAutoCallback && !meta._meta_actions.includes('REQUEST_CHAT_MODEL')) {
                                meta._meta_actions.push('REQUEST_CHAT_MODEL');
                            }
                        } else if (block.arg === 'execute_and_wait') {
                            meta._meta_actions = meta._meta_actions.filter(action => action !== 'REQUEST_CHAT_MODEL');
                        }

                        results.push({
                            type: 'metaAction',
                            success: true,
                            data: block.arg
                        });
                        break;
                    }

                    case 'jobCompleted':
                    case 'jobFailed':
                        stop = true;
                        await handleJobFinished(block, url, headers, results);
                        break;
                }
            }

            const allSuccessful = results.every(r => r.success);

            if (allSuccessful) {
                return {
                    data: {
                        message: "All operations completed successfully",
                        results
                    },
                    ...meta
                };
            } else {
                if (!disableAutoCallback) meta._meta_actions = ["REQUEST_CHAT_MODEL"]
                return {
                    data: {
                        error: "Some operations failed",
                        results
                    },
                    ...meta,

                };
            }
        } catch (e) {
            if (!disableAutoCallback) meta._meta_actions = ["REQUEST_CHAT_MODEL"]
            return {
                error: e.response?.data || e.message,
                ...meta
            };
        }
    }]
];