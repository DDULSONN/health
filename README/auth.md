# Auth Troubleshooting Checklist

## 1) Supabase Dashboard Settings

### Authentication > URL Configuration
- Site URL: `https://helchang.com`
- Redirect URLs:
- `https://helchang.com/*`
- `https://helchang.com/auth/callback`
- `https://helchang.com/auth/reset-password`

### Authentication > Providers > Email
- Confirm email: `ON` (recommended)

### Authentication > Email > SMTP (Custom SMTP)
- Resend SMTP settings are saved
- `From` email uses verified domain (example: `no-reply@helchang.com`)

## 2) If Verification Email Is Not Delivered
- Check Supabase Logs for SMTP/auth failures.
- Verify Resend domain and sender verification status.
- Confirm there is no typo in SMTP host/port/user/password.
- Confirm app redirect URL is exactly `https://helchang.com/...`.

## 3) App UX Expectations
- New signup:
- Show: `가입 요청이 완료되었습니다. 메일함에서 인증 후 로그인하세요.`
- Existing email signup:
- Show: `이미 가입된 이메일입니다. 로그인해 주세요.`
- Offer CTA to login and reset password.
- Unconfirmed login:
- Show: `메일 인증이 필요합니다. 인증 후 로그인해주세요.`
- Offer `인증 메일 다시 보내기`.
