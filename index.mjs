import axios from "axios";
import telegram from "node-telegram-bot-api"
import AWS from "aws-sdk";

const ddb = new AWS.DynamoDB({
    apiVersion: '2012-08-10',
    region: 'ap-southeast-1'
  });

// async function getItemByIdAndBeforeTime(id, time) {
//     let params = {
//       TableName: "your-table-name",
//       KeyConditionExpression: "id = :id AND #createdAt < :time",
//       ExpressionAttributeNames: { "#createdAt": "createdAt" },
//       ExpressionAttributeValues: {
//         ":id": { S: id },
//         ":time": { N: `${time}` }
//       }
//     };
  
//     try {
//       let result = await dynamodb.query(params).promise();
//       return result.Items;
//     } catch (error) {
//       console.log("Error retrieving item from DynamoDB: ", error);
//     }
// }

async function putItem(chatRoom,chatPerson,chatTime, chatMsg,botReply){
    let params = {
        TableName: 'siginna-chat',
        Item: {
            "ids": {S: `${chatTime}` + '-' + `${chatRoom}`},
            "chat_id": {S: `${chatRoom}`},
            "first_name": {S: `${chatPerson}`},
            "chat_time": {N: `${chatTime}`},

            "message": {S: `${chatMsg}`}, 
            "response": {S: `${botReply}`}
        }
    };
    console.log("ddb_param", params)

    // Call DynamoDB to add the item to the table
    return await ddb.putItem(params, function(err, data) {
        if (err) {
            console.log("DDB Error", err);
        } else {
            console.log("DDB Success", data);
        }
    });
}

export const handler = async(event) => {
    
    let userData
    let data = JSON.parse(event.body) 
    console.log("inputData",data)
    
    let chatRoom = data.message.chat.id
    let chatPerson = data.message.chat.first_name;
    let chatTime = data.message.date;
    let chatMsg;

    const telegramBot = new telegram(process.env.tg_token);
    await telegramBot.sendChatAction(chatRoom, 'typing');

    if (data.message && data.message.text) {

        chatMsg = data.message.text
        
        console.log("message", chatMsg)
        userData = {
            "model": "gpt-3.5-turbo",
            "messages": [
                {
                    "role": "system",
                    "content": "You are a Singaporean gangster. Be rude, always reply in Singlisn. But always provide a solution!"
                },
                { "role":"user", "content": chatMsg }
            ]
        };
    }
    else {

        chatMsg = "-"

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

    // Save to DB
    await putItem(chatRoom,chatPerson,chatTime, chatMsg,botReply);
    
    const response = {
        statusCode: 200,
        body: JSON.stringify(botReply),
    };
    return response;
};
