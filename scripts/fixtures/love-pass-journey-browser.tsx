import { createRoot } from 'react-dom/client';
import DatingLovePassPage from '@/app/dating/love-pass/page';
import PaymentSuccessPage from '@/app/payments/success/page';

const root = document.getElementById('root');
if (root) createRoot(root).render(window.location.pathname === '/payments/success' ? <PaymentSuccessPage /> : <DatingLovePassPage />);
