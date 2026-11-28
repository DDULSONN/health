import React from 'react';
import { createRoot } from 'react-dom/client';
import Page from '../../app/admin/support/page';
import Attention from '../../components/admin/AdminSupportAttention';
createRoot(document.getElementById('root')!).render(<><Attention /><Page /></>);
