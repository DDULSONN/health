# Login/Auth Checklist

## Domains and Redirects
- Production domain: `https://helchang.com`
- Supabase Auth Site URL: `https://helchang.com`
- Supabase Redirect URLs:
- `https://helchang.com/*`
- `https://helchang.com/auth/callback`
- `https://helchang.com/auth/reset-password`

## Providers
- Google OAuth enabled
- Email OTP/Magic Link enabled
- Email/Password enabled
- SMTP configured (Resend)

## URL Configuration
- Google Cloud OAuth redirect URI:
- `https://kypyuqugiltjjgqyiskf.supabase.co/auth/v1/callback`
- Google Cloud authorized JavaScript origin:
- `https://helchang.com`

## App Flow
- Login page: `/login`
- Callback page: `/auth/callback`
- Callback completion route: `/auth/callback/complete`
- Password reset page: `/auth/reset-password`

## UX Rules
- In-app browser (`KAKAOTALK`, `Instagram`, `FBAN`, `FBAV`, `NAVER`, `LINE`):
- Google login disabled
- OTP and Password login still enabled
- Show external browser guidance
- Login page checks session first:
- If session exists: show success state then redirect to `next`
- Do not show stale callback error

## Callback Branches
- `error/error_code` -> error UI and resend CTA
- `code` -> `exchangeCodeForSession`
- `token_hash + type` -> `verifyOtp`
- `access_token + refresh_token` -> `setSession`
- fallback -> invalid link guidance to `/login`

## Local Storage
- Key: `recent_login_email`
- Used for OTP resend prefill after `otp_expired` and callback errors

