// The invite page: reads the code from the address (/join#ABCD-EFGH, or /join/ABCD-EFGH), points "Open in the app"
// at parklane://join/<code> and shows the code to type in the app if the link can't open it. Nothing is sent anywhere:
// the part after # never leaves the phone.
(() => {
  const match = /^#?([0-9A-Za-z]{4})-?([0-9A-Za-z]{4})$/.exec(decodeURIComponent(location.hash)) ?? /^\/join\/([0-9A-Za-z]{4})-?([0-9A-Za-z]{4})\/?$/.exec(location.pathname);
  if (!match) return;
  const code = `${match[1]}-${match[2]}`.toUpperCase();
  document.getElementById('open').href = `parklane://join/${code}`;
  document.getElementById('code').textContent = code;
  document.getElementById('code-box').hidden = false;
  const copied = document.getElementById('copied');
  document.getElementById('copy').addEventListener('click', () => {
    const done = () => (copied.textContent = 'Copied. Paste it in the app.');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(done, () => (copied.textContent = 'Press and hold the code to copy it.'));
    } else {
      copied.textContent = 'Press and hold the code to copy it.';
    }
  });
})();
