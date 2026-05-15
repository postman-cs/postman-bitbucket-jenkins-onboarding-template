const url = process.argv[2];
const timeoutSeconds = Number(process.argv[3] || 60);

if (!url) {
  throw new Error('Usage: node wait-for-url.mjs <url> [timeoutSeconds]');
}

const startedAt = Date.now();
let lastError = '';

while (Date.now() - startedAt < timeoutSeconds * 1000) {
  try {
    const response = await fetch(url);
    if (response.status < 500) {
      console.log(`Ready: ${url}`);
      process.exit(0);
    }
    lastError = `HTTP ${response.status}`;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));
}

throw new Error(`Timed out waiting for ${url}: ${lastError}`);
