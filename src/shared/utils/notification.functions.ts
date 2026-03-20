import axios from 'axios';

export async function sendNotificationsFor(
  ids: string[] = [],
  message: string,
) {
  const privateKey = process.env.ONESIGNAL_PRIVATEKEY;
  const appId = process.env.ONESIGNAL_APP_ID_CLIENT;

  const cleanedIds = ids.filter(Boolean);

  if (!privateKey || !appId || !cleanedIds.length) {
    return;
  }

  try {
    await axios.post(
      'https://api.onesignal.com/notifications?c=push',
      {
        app_id: appId,
        include_subscription_ids: cleanedIds,
        headings: {
          en: 'Rappidex Express',
          pt: 'Rappidex Express',
        },
        contents: {
          en: message,
          pt: message,
        },
      },
      {
        headers: {
          Authorization: `Key ${privateKey.replace(/^Key\s+/i, '')}`,
          accept: 'application/json',
          'content-type': 'application/json',
        },
      },
    );
  } catch (error: any) {
    console.log(
      'Falha ao enviar notificação:',
      error?.response?.data ?? error?.message ?? error,
    );
  }
}
