import {getActions} from './actions.js';

export const handler = async (event) => {
    const maxSelfInvokeMessagesCount = 50;
    const actions = getActions({
        _meta_actions: event?.payload?.messages?.length > maxSelfInvokeMessagesCount
            ? ["REQUEST_CHAT_MODEL_EXCEEDED"]
            : ["REQUEST_CHAT_MODEL"]
    });

    for (let [regex, action] of actions) {
        const lastMessage = event.payload.messages[event.payload.messages.length - 1].content;        
        const match = lastMessage?.match(regex);
        if (match) return await action(match, event);
    }

    return { type: 'CONTINUE' }
};