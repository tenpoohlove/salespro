import nodemailer from 'nodemailer';

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587'),
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function sendVerificationEmail(email: string, name: string, token: string, userId: string): Promise<void> {
  const siteUrl = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const link = `${siteUrl}/verify-email.html?token=${token}&userId=${userId}`;

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`\n[メール確認 - SMTP未設定のためコンソール出力]\n宛先: ${email}\n確認リンク: ${link}\n`);
    return;
  }

  await transporter.sendMail({
    from: `"Pitch Navi" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'メールアドレスの確認をお願いします',
    html: `
      <div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f0f13;color:#e2e8f0;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="width:52px;height:52px;background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:26px;">📈</div>
          <h2 style="color:#c084fc;margin-top:12px;">メールアドレスの確認</h2>
        </div>
        <p>${name} さん、ご登録ありがとうございます。</p>
        <p style="margin-top:8px;">下のボタンをクリックしてメールアドレスを確認してください。</p>
        <p style="text-align:center;margin:32px 0;">
          <a href="${link}" style="background:#7c3aed;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;">メールアドレスを確認する</a>
        </p>
        <p style="color:#64748b;font-size:12px;">このリンクは24時間有効です。</p>
        <p style="color:#64748b;font-size:12px;">心当たりがない場合は、このメールを無視してください。</p>
      </div>
    `,
  });
}
