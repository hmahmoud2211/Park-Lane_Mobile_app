// The /account/delete page: signs in with the account's own credentials, deletes the account, and
// shows what happened. Talks only to this backend's /api/auth routes (the page's CSP allows nothing else).
'use strict';

const form = document.getElementById('delete-form');
const status = document.getElementById('status');
const button = document.getElementById('submit');

async function call(path, body, token) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok || !answer.ok) {
    throw new Error((answer.error && answer.error.message) || 'Something went wrong. Try again later.');
  }
  return answer.data;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) {
    status.textContent = 'Enter your email or username and your password.';
    return;
  }
  if (!document.getElementById('confirm').checked) {
    status.textContent = 'Tick the box to confirm you want to delete your account.';
    return;
  }
  button.disabled = true;
  status.textContent = 'Deleting…';
  try {
    const { token } = await call('/api/auth/login', { email, password });
    await call('/api/auth/delete-account', { password }, token);
    form.replaceChildren();
    const done = document.createElement('p');
    done.textContent = 'Your account has been deleted. You can uninstall the app.';
    form.append(done);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});
