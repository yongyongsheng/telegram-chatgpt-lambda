// Author: YS

import axios from "axios";
import telegram from "node-telegram-bot-api"
import AWS from "aws-sdk";
import * as fs from 'fs';

const ddb = new AWS.DynamoDB({
    apiVersion: '2012-08-10',
    region: 'ap-southeast-1'
});

const locationService = new AWS.Location({
    region: 'ap-southeast-1'
});
const transcribeService = new AWS.TranscribeService({
    region: 'ap-southeast-1'
});
const s3Service = new AWS.S3({
    region: 'ap-southeast-1'
});
const lambdaService = new AWS.Lambda();

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
    else if (data.message && data.message.location) {

        let params = {
            IndexName: 'whyys_places',
            Position: [data.message.location.longitude, data.message.location.latitude],
            MaxResults: 1
        };

        let loc = await locationService.searchPlaceIndexForPosition(params).promise();
        if (loc && loc.Results) {
            let place = loc.Results[0].Place;
            console.log("Address returned from locationService", JSON.stringify(place))

            chatMsg = place.AddressNumber + ", "
            if (place.Street) chatMsg += place.Street + ", "
            if (place.Municipality) chatMsg += place.Municipality + ", "
            chatMsg += place.Country + " " + place.PostalCode

            apiMsg.push({ "role": "user", "content": "My address now is " + chatMsg })

            // Check if you have blog content about nearby shops?
            let lambdaParams = {
                FunctionName: 'eatluh-location', // the lambda function we are going to invoke
                InvocationType: 'RequestResponse',
                LogType: 'Tail',
                Payload: '{ "postal" : "'+ place.PostalCode +'" }'
            };
            let mappedBlogs = await lambdaService.invoke(lambdaParams).promise();
            if (mappedBlogs && mappedBlogs.Payload){
                let arrBlogs = JSON.parse(mappedBlogs.Payload);
                let urlBlogs = '';
                if (arrBlogs.length > 0) { 
                    for(var i=0; i<arrBlogs.length && i<5; i++){ 
                        if (arrBlogs[i].url)
                            urlBlogs += arrBlogs[i].url + ' , '; 
                    }
                    console.log( arrBlogs.length + " blogs found", urlBlogs)
                    apiMsg.push({ "role": "system", "content": "Only based on content written in " + urlBlogs + " recommend less than 6 food places that are near to '" + chatMsg + "' and quote the address and the blog url."})
                }
                else {
                    apiMsg.push({ "role": "system", "content": "Tell user his location is " + locText + " and ask him what he wants to find out about the location?" })
                }
            }
            else {
                apiMsg.push({ "role": "system", "content": "Tell user his location is " + locText + " and ask him what he wants to find out about the location?" })
            }
        
        }
        else {
            // Fall back to hope that GPT can give location
            chatMsg = "my latitude " + data.message.location.latitude + " and longitude is " + data.message.location.longitude + "."

            apiMsg.push({ "role": "user", "content": "be nice and helpful." + chatMsg + " tell me the district, town, city and country. where am i?" })
            apiMsg.push({ "role": "system", "content": "tell user his exact location and ask what he does want?" })
        }

    }
    else if (data.message && data.message.voice) {
        // Download audio file from TG
        toLogDb = false;
        let voiceSucceed = false;
        let jobId = Date.now() + '-' + data.message.voice.file_unique_id;
        let dlAudioPath = await telegramBot.downloadFile(data.message.voice.file_id, "/tmp/")

        if (dlAudioPath){
            await telegramBot.sendMessage(chatRoom, "Wahlau, listening to your voice message...");

            // Upload into S3 
            let s3Param = {
                Bucket: 'ys-machinelearning',
                Key: 'siginna/telegram/' + jobId + '.ogg',
                Body: fs.readFileSync(dlAudioPath),
                ContentType: data.message.voice.mime_type,
                ACL: 'private', //Setting the file permission
            };
            let s3result = await s3Service.upload(s3Param).promise();
            if (s3result) {

                // Call transcribe 
                let tscpJob
                let tscpParams = {
                    TranscriptionJobName: jobId,
                    LanguageCode: 'en-US',
                    MediaFormat: 'ogg', // specify the input media format
                    Media: {
                        MediaFileUri: 's3://ys-machinelearning/' + 'siginna/telegram/' + jobId + '.ogg' //event.mediaFileUri // the URL of the input media file
                    },
                    OutputBucketName: 'ys-machinelearning', //the bucket where you want to store the text file.
                    OutputKey: 'siginna/transcribe/' + jobId + '.json',
                    Settings: {
                        ShowSpeakerLabels: false
                    }
                };
                let tscpStart = await transcribeService.startTranscriptionJob(tscpParams).promise();
                console.log('0 START', tscpStart)
                await new Promise(resolve => setTimeout(resolve, 5000));

                for (var i = 0; i < 60; i++) {
                    tscpJob = await transcribeService.getTranscriptionJob({
                        TranscriptionJobName: jobId
                    }).promise();
                    console.log(i + ' JOB', tscpJob.TranscriptionJob.TranscriptionJobStatus)
                    if (tscpJob.TranscriptionJob.TranscriptionJobStatus == 'COMPLETED' || tscpJob.TranscriptionJob.TranscriptionJobStatus == 'FAILED') {
                        console.log("tscpJob", i, tscpJob);
                        break;
                    }
                    else {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                if (tscpJob.TranscriptionJob.TranscriptionJobStatus == 'COMPLETED') {
                    // Transcribe job compeleted, read the message from JSON file
                    let s3GetParams = {
                        Bucket: 'ys-machinelearning',
                        Key: 'siginna/transcribe/' + jobId + '.json'
                    };
                    let voiceFile = await s3Service.getObject(s3GetParams).promise();
                    let voiceData = JSON.parse(voiceFile.Body.toString('utf-8'));
                    console.log("voiceData", JSON.stringify(voiceData))

                    if (voiceData && voiceData.results) {
                        chatMsg = '';
                        for (var i = 0; i < voiceData.results.transcripts.length; i++) {
                            console.log(voiceData.results.transcripts[i]);
                            chatMsg += voiceData.results.transcripts[i].transcript + " ";
                        }
                        await telegramBot.sendMessage(chatRoom, "You: " + chatMsg);

                        voiceSucceed = true;
                        toLogDb = true;

                        //START OF REUSE CODE FROM TEXT MESSAGE
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
                        //END OF REUSE CODE FROM TEXT MESSAGE
                    }
                }
            }
        }


        if (!voiceSucceed) {
            apiMsg.push({ "role": "system", "content": "Apologize that you cannot understand his voice message and he should try again or send you in text." })
        }

    }
    else {
        toLogDb = false;
        apiMsg.push({ "role": "system", "content": "ask user what he want?" })
    }


    // bot is typing
    await telegramBot.sendChatAction(chatRoom, 'typing');


    apiData = {
        "model": process.env.openai_model,
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
}