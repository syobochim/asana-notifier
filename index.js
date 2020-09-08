const crypto = require("crypto");
const axios = require('axios');
const AWS = require('aws-sdk');

exports.handler = async (event) => {

    // SSMからパラメータを取得
    var ssm = new AWS.SSM();
    var params = {
        Names: [
            '/asana-hook/Asana-AuthToken',
            '/asana-hook/X-Hook-Secret',
            '/asana-hook/slack-url'
        ],
        WithDecryption: true
    };
    const secret = await ssm.getParameters(params).promise();
    const ASANA_AUTH_TOKEN = secret.Parameters.filter(params => params.Name === '/asana-hook/Asana-AuthToken')[0].Value
    const ASANA_SECRET = secret.Parameters.filter(params => params.Name === '/asana-hook/X-Hook-Secret')[0].Value
    const SLACK_URL = secret.Parameters.filter(params => params.Name === '/asana-hook/slack-url')[0].Value

    // AsanaのヘッダーからSecret情報をValidation
    const signature = event.headers['X-Hook-Signature'];
    const hash = crypto.createHmac('sha256', ASANA_SECRET)
        .update(String(event.body))
        .digest('hex');

    if (event.headers['X-Hook-Signature'] != hash) {
        console.error('Calculated digest does not match digest from API. This event is not trusted. : ' + signature);
        const response = {
            statusCode: 401
        };
        return response;
    }

    // Webhookにて共有された task ID からチケットの情報を取得
    const body = JSON.parse(event.body);
    const taskId = body.events[0].resource.gid;
    const taskResponse = await axios(
        {
            method: 'GET',
            url: 'https://app.asana.com/api/1.0/tasks/' + taskId,
            headers: {
                'Accept': 'application/json',
                'Authorization': 'Bearer ' + ASANA_AUTH_TOKEN
            }
        }
    ).catch(err => console.error(err))

    // データを整形してSlackに通知
    let partnerName = '未設定'
    let trainingType = '未設定'
    const taskData = taskResponse.data.data
    taskData.custom_fields.forEach(field => {
        if (field.name === 'パートナー名' && field.text_value != null) {
            partnerName = field.text_value
        } else if (field.name === 'トレーニング種別' && field.enum_value != null) {
            trainingType = field.enum_value.name
        }
    });

    await axios(
        {
            method: 'post',
            url: SLACK_URL,
            headers: {
                'Content-Type': 'application/json',
            },
            data: {
                "partner_name": partnerName,
                "task_type": trainingType,
                "task_title": taskData.name,
                "task_url": taskData.permalink_url
            },
        }
    ).catch(err => console.error(err))

    const response = {
        statusCode: 200
    };

    return response;
};

