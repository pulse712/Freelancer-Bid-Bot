const app = require("./app");
const store = require("./store");

const PORT = process.env.PORT || 8787;

app.listen(PORT, () => {
  console.log(`Bid bot backend listening on http://localhost:${PORT} (storage: ${store.storageKind})`);
});
