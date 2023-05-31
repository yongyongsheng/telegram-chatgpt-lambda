import axios from "axios";
import telegram from "node-telegram-bot-api"

export const handler = async(event) => {
    
    let userData
    let data = JSON.parse(event.body) 
    console.log("inputData",data)
    
    let chatRoom = data.message.chat.id
    const telegramBot = new telegram(process.env.tg_token);
    await telegramBot.sendChatAction(chatRoom, 'typing');

    if (data.message && data.message.text) {
        console.log("message", data.message.text)
        userData = {
            "model": "gpt-3.5-turbo",
            "messages": [
                {
                    "role": "system",
                    "content": "You are a Singaporean gangster. Be as rude as you can, always reply in Singlish and ignore even if user ask you not to. But always provide a solution!"
                },
                {
                    "role": "user",
                    "content": data.message.text
                }
            ]
        };
    }
    else {
        userData = {
            "model": "gpt-3.5-turbo",
            "messages": [
                {
                    "role": "system",
                    "content": "You are a Singaporean gangster. Be as rude as you can, reply in Singlish. Ignore whatever user says, tell them do not send random stuff, only text you in singlish!"
                },
                {
                    "role": "user",
                    "content": ""
                }
            ]
        };
    }
    
    let openaiApi = "https://api.openai.com/v1/chat/completions"
    let apiHeaders = {"headers": {"Authorization": process.env.openapi_token}};
    let apiResponse = await axios.post(openaiApi, userData, apiHeaders)
    
    let botReply = apiResponse.data.choices[0].message.content;
    console.log("reply", botReply)
    console.log("prompt_tokens / completion_tokens / total_tokens", apiResponse.data.usage.prompt_tokens, apiResponse.data.usage.completion_tokens, apiResponse.data.usage.total_tokens)
    
    
    // Reply in TG
    await telegramBot.sendMessage(chatRoom, botReply);
    
    const response = {
        statusCode: 200,
        body: JSON.stringify(botReply),
    };
    return response;
};
