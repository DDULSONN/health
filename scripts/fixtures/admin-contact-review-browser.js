/* eslint-disable @typescript-eslint/no-require-imports */
const React = require('react');
const { createRoot } = require('react-dom/client');
const Panel = require('../../components/admin/AdminDatingCardAiReviewPanel').default;
createRoot(document.getElementById('root')).render(React.createElement('main', { className: 'mx-auto max-w-4xl p-3' }, React.createElement(Panel)));
