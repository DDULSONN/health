# Auth Setup Checklist

## 1) Supabase Dashboard

### Authentication > URL Configuration
- Site URL: `https://helchang.com`
- Redirect URLs:
- `https://helchang.com/*`
- `https://helchang.com/auth/callback`
- `https://helchang.com/auth/reset-password`

### Authentication > Providers > Email
- Confirm email: `ON` (recommended)

### Authentication > Email > SMTP (Custom SMTP)
- Resend SMTP values are saved
- Sender address uses verified domain (for example `no-reply@helchang.com`)

## 2) Delivery Troubleshooting
- Check Supabase logs for SMTP/auth errors.
- Check Resend domain/sender verification status.
- Verify SMTP host, port, user, and password.
- Confirm redirect URLs exactly match `https://helchang.com/...`.

## 3) Expected UX
- New signup: show `가입 요청이 완료되었습니다. 메일함에서 인증 후 로그인하세요.`
- Existing email signup: show `이미 가입된 이메일입니다. 로그인해 주세요.`
- Unconfirmed login: show `메일 인증이 필요합니다. 인증 후 로그인해 주세요.`
- Provide CTA for login, password reset, and resend verification email.
