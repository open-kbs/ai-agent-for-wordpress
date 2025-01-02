import React, { useEffect, useState } from "react";
import {Button, Chip, Tooltip, ThemeProvider, createTheme} from '@mui/material';
import {Autorenew, TravelExplore, Preview, HourglassEmpty, CallMade, EditNote, Check} from '@mui/icons-material';


const style = document.createElement('style');
style.innerHTML = `
    .codeContainer, .codeContainer code {
        background-color: #0d0d0d !important;
        color: white !important;
        text-shadow: none !important;
        border-radius: 10px !important;
        font-size: 13px !important;
    }
    .codeContainer * {
        background-color: #0d0d0d !important;
    }
`;
document.head.appendChild(style);

const Header = ({ setRenderSettings }) => {
    useEffect(() => {
        setRenderSettings({
            disableCodeExecuteButton: true,
            inputLabelsQuickSend: true,
        });
    }, [setRenderSettings]);
};

const isMobile = window?.openkbs?.isMobile;

const ChatMessageRenderer = ({ content, CodeViewer, setInputValue, sendButtonRippleRef }) => {
    const [addedSuggestions, setAddedSuggestions] = useState([]);

    const handleSuggestionClick = (suggestion) => {
        setInputValue((prev) => prev + (prev ? '\n' : '') + suggestion);
        setAddedSuggestions((prev) => [...prev, suggestion]);
        setTimeout(() => sendButtonRippleRef?.current?.pulsate(), 100);
    };

    const output = [];
    let language = null;

    content.split('\n').forEach(line => {
        const writeFileMatch = /writeFile\s+(?<filePath>[^\s]+)/.exec(line);
        const codeStartMatch = /```(?<language>\w+)/g.exec(line);
        const commandMatch = /\/(?<command>googleSearch|webpageToText|viewImage|metaAction|suggestion|jobCompleted|jobFailed)\((?<args>[^()]*)\)/g.exec(line);

        if (!language && codeStartMatch) {
            language = codeStartMatch.groups.language;
            output.push({ language, code: '' });
        } else if (language && line.match(/```/)) {
            language = null;
        } else if (language) {
            output[output.length - 1].code += line + '\n';
        } else if (commandMatch || writeFileMatch) {
            const command = commandMatch?.groups?.command || 'writeFile';
            let args = commandMatch?.groups?.args || writeFileMatch?.groups?.filePath;
            if (args?.startsWith('"') && args?.endsWith('"')) args = args.slice(1, -1); // remove quotes if any
            output.push({ command, args, line });
        } else {
            output.push(line);
        }
    });

    return <ThemeProvider theme={() => createTheme(window.openkbsTheme)}>
        {output.map((o, i) => {
        if (typeof o === 'string') {
            return <p key={i} style={{ marginTop: '0px', marginBottom: '0px' }}>{o}</p>;
        } else if (o.command) {
            if (o.command === 'suggestion') {
                const added = addedSuggestions?.includes(o.args);
                return (
                    <div key={`a${i}`}>
                        <Button
                            variant="contained"
                            color="primary"
                            disabled={added}
                            onClick={() => handleSuggestionClick(o.args)}
                            style={{ margin: '5px', textTransform: 'none' }}
                        >
                            {added ? <Check fontSize="small" sx={{mr: 2}} /> : ''}{o.args}
                        </Button>
                    </div>
                );
            } else if (o.command) {
                const argsIcons = {
                    'execute_and_wait': <HourglassEmpty />,
                    'execute_and_callback': <Autorenew />
                };

                const commandIcons = {
                    'googleSearch': <TravelExplore />,
                    'webpageToText': <Preview />,
                    'writeFile': <EditNote  />
                };

                const icon = argsIcons[o.args] || commandIcons[o.command];
                return <div style={{ marginTop: '5px', marginBottom: '5px' }}>
                    <Tooltip title={o.line} placement="right">
                        <Chip
                            sx={{mt: '10px'}}
                            icon={icon}
                            label={o.args}
                            variant="outlined"
                            deleteIcon={ <CallMade
                                style={{
                                    fontSize: 12,
                                    borderRadius: '50%',
                                    padding: '4px',
                                }}
                            /> }
                            onDelete={() => {}}
                        />
                    </Tooltip>
                </div>
            }
        } else {
            return (
                <div key={i}>
                    <CodeViewer
                        limitedWidth={isMobile}
                        language={o.language}
                        className="codeContainer"
                        source={o.code}
                    />
                </div>
            );
        }
    })}
    </ThemeProvider>
};

const onRenderChatMessage = async (params) => {
    const { content } = params.messages[params.msgIndex];
    const { CodeViewer, setInputValue, sendButtonRippleRef } = params;

    if (content.match(/```/) || content.match(/\/(?<command>\w+)\(([\s\S]*)\)/g)) {
        return (
            <ChatMessageRenderer
                content={content}
                CodeViewer={CodeViewer}
                setInputValue={setInputValue}
                sendButtonRippleRef={sendButtonRippleRef}
            />
        );
    }
};

const exports = { onRenderChatMessage, Header };
window.contentRender = exports;
export default exports;