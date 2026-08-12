import { createServer } from "node:http";
import { mockTranslateBatch } from "../../src/shared/mock-translation";
import type { TargetLanguage, TranslationRequest } from "../../src/shared/contracts";

const port = Number(process.env.LAYOUT_TRANSLATE_MOCK_PORT ?? 8787);

function writeJson(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    });
    response.end();
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/translate") {
    writeJson(response, 404, { error: "Not found" });
    return;
  }

  let raw = "";
  request.setEncoding("utf8");
  for await (const chunk of request) raw += chunk;
  try {
    const body = JSON.parse(raw) as {
      targetLanguage?: TargetLanguage;
      items?: TranslationRequest[];
    };
    if ((body.targetLanguage !== "en" && body.targetLanguage !== "vi") || !Array.isArray(body.items)) {
      writeJson(response, 400, { error: "targetLanguage and items are required" });
      return;
    }
    const translations = await mockTranslateBatch(body.items, body.targetLanguage);
    writeJson(response, 200, { translations });
  } catch {
    writeJson(response, 400, { error: "Invalid JSON request" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Layout Translate mock backend listening on http://127.0.0.1:${port}`);
});
