import axios from "axios";
import telegram from "node-telegram-bot-api"
import AWS from "aws-sdk";

const ddb = new AWS.DynamoDB({
    apiVersion: '2012-08-10',
    region: 'ap-southeast-1'
});

const telegramBot = new telegram(process.env.tg_token);

async function getItemRecent(chat_id, chat_time_now) {
    let chat_time = chat_time_now - 3600;
    let params = {
        TableName: "si-ginna-convo",
        KeyConditionExpression: "chat_id = :chat_id AND #chat_time > :chat_time",
        ExpressionAttributeNames: { "#chat_time": "chat_time" },
        ExpressionAttributeValues: {
            ":chat_id": { S: `${chat_id}` },
            ":chat_time": { N: `${chat_time}` }
        }
    };

    try {
        let result = await ddb.query(params).promise();
        //console.log("getItem", result)
        return result.Items;
    } catch (error) {
        console.log("Error retrieving item from DynamoDB: ", error);
    }
}

async function putItem(chat_id, first_name, chat_time, message, response) {
    let params = {
        TableName: 'si-ginna-convo',
        Item: {
            "chat_id": { S: `${chat_id}` },
            "first_name": { S: `${first_name}` },
            "chat_time": { N: `${chat_time}` },

            "message": { S: `${message}` },
            "response": { S: `${response}` }
        }
    };

    // Call DynamoDB to add the item to the 
    try {
        await ddb.putItem(params).promise();
        return true;
    } catch (error) {
        console.log("Error put to DynamoDB: ", error);
    }

    return
}

export const handler = async (event) => {

    let data = JSON.parse(event.body)
    console.log("inputData", data)

    let apiData
    let apiMsg = []
    let toLogDb = true;

    let chatRoom = data.message.chat.id
    let chatPerson = data.message.chat.first_name;
    let chatTime = data.message.date;
    let chatMsg;

    // Start preping the API
    apiMsg.push({ "role": "system", "content": "You are a Singaporean gangster. Be rude, always reply in Singlisn. But always provide a solution!" })


    if (data.message && data.message.text) {

        chatMsg = data.message.text
        //console.log("message", chatMsg)

        
        //GET HISTORY
        let history = await getItemRecent(chatRoom, chatTime);
        if (history && history.length > 0) {
            console.log("history", history.length, history)

            var len = process.env.log_length
            var max = (history.length > len) ? len : history.length;
            for (var i = 0; i < max; i++) {
                var m = history.length - max + i
                console.log(m, history[m].message.S)
                console.log(m, history[m].response.S)

                apiMsg.push({ "role": "user", "content": history[m].message.S })
                apiMsg.push({ "role": "assistant", "content": history[m].response.S })
            }
        }

        apiMsg.push({ "role": "user", "content": chatMsg })

    }
    else {
        toLogDb = false;
        chatMsg = "-"

        apiMsg.push({ "role": "system", "content": "remind user to stop sending nonsense and type in singlish if they need help" })
    }


    // bot is typing
    await telegramBot.sendChatAction(chatRoom, 'typing');


    apiData = {
        "model": "gpt-3.5-turbo",
        "messages": apiMsg
    };
    console.log("apiData", apiData);

    let openaiApi = "https://api.openai.com/v1/chat/completions";
    let apiHeaders = { "headers": { "Authorization": process.env.openapi_token } };
    let apiResponse = await axios.post(openaiApi, apiData, apiHeaders);

    let botReply = apiResponse.data.choices[0].message.content;
    console.log("prompt_tokens / completion_tokens / total_tokens", apiResponse.data.usage.prompt_tokens, apiResponse.data.usage.completion_tokens, apiResponse.data.usage.total_tokens)

    // Reply in TG
    await telegramBot.sendMessage(chatRoom, botReply);

    // Save to DB
    if (toLogDb) {
        await putItem(chatRoom, chatPerson, chatTime, chatMsg, botReply);
    }


    const response = {
        statusCode: 200,
        body: JSON.stringify(botReply),
    };
    return response;
};
