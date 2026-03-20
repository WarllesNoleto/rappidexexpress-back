import axios from 'axios';

export async function sendNotificationsFor(ids: string[] = [], message: string) {
  const privateKey = process.env.ONESIGNAL_PRIVATEKEY;
  const appId = process.env.ONESIGNAL_APP_ID_CLIENT;

  if (!privateKey || !appId || !ids.length) {
    return;
  }

  const headers = {
    Authorization: privateKey,
    accept: 'application/json',
    'content-type': 'application/json',
  };

  const data = {
    app_id: appId,
    include_subscription_ids: ids,
    data: { foo: 'bar' },
    headings: { en: 'Rappidex Express' },
    contents: { en: message },
  };

  const api = axios.create({
    baseURL: 'https://onesignal.com/api/v1',
    headers,
  });

  try {
    await api.post('/notifications', data);
  } catch (error) {
    console.log('Falha ao enviar notificação:', error);
  }
}
