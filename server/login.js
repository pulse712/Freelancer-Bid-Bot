module.exports = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Bid Bot - Log in</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
  <style>
    body { font-family: Arial, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #10111a; color: #e8ebff; }
    form { background: #171a27; border: 1px solid #2c2f44; border-radius: 10px; padding: 28px; width: 320px; }
    h1 { font-size: 18px; margin: 0 0 4px; display: flex; align-items: center; gap: 10px; }
    h1 img { width: 28px; height: 28px; }
    p { font-size: 12px; color: #8a8ea8; margin: 0 0 16px; }
    label { display: block; margin: 10px 0 4px; font-size: 12px; color: #c7c9d9; }
    input { width: 100%; box-sizing: border-box; padding: 9px; background: #10111a; color: #e8ebff; border: 1px solid #2c2f44; border-radius: 6px; font-size: 14px; }
    button { width: 100%; margin-top: 14px; padding: 9px 12px; border: 0; border-radius: 6px; background: #4b7bff; color: #fff; cursor: pointer; font-size: 14px; }
    button:disabled { opacity: 0.6; cursor: default; }
    .error { color: #ff6b6b; font-size: 12px; min-height: 16px; margin-top: 10px; }
  </style>
</head>
<body>
  <form id="loginForm">
    <h1><img src="/favicon.svg" alt="" />Bid Bot</h1>
    <p>Enter the dashboard password to continue.</p>
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" autofocus required />
    <button id="loginBtn" type="submit">Log in</button>
    <div class="error" id="error"></div>
  </form>
  <script>
    const form = document.getElementById("loginForm");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = document.getElementById("loginBtn");
      const error = document.getElementById("error");
      button.disabled = true;
      error.textContent = "";
      try {
        const response = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: document.getElementById("password").value })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Login failed (" + response.status + ")");
        location.replace("/");
      } catch (err) {
        error.textContent = err.message;
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
