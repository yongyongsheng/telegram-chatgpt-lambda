import axios from "axios";
import telegram from "node-telegram-bot-api"
import AWS from "aws-sdk";

const ddb = new AWS.DynamoDB({
    apiVersion: '2012-08-10',
    region: 'ap-southeast-1'
  });

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
    //console.log("get1", params)
  
    try {
      let result = await ddb.query(params).promise();
      //=console.log("get2", result)
      return result.Items;
    } catch (error) {
      console.log("Error retrieving item from DynamoDB: ", error);
    }
}

async function putItem(chat_id,first_name,chat_time, message,response){
    let params = {
        TableName: 'si-ginna-convo',
        Item: {
            //"ids": {S: `${chat_time}` + '-' + `${chat_id}`},
            "chat_id": {S: `${chat_id}`},
            "first_name": {S: `${first_name}`},
            "chat_time": {N: `${chat_time}`},

            "message": {S: `${message}`}, 
            "response": {S: `${response}`}
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
        //console.log("message", chatMsg)

//GET HISTORY
let history = await getItemRecent(chatRoom, chatTime);
if (history && history.length >0){
  console.log("history",history.length, history)
  
  for(var i=0; i<3; i++){
    var m= history.length - i -1
    console.log(m, history[m].message.S)
    console.log(m, history[m].response.S)
  }
}
    

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
    //console.log("reply", botReply)
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
