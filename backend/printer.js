
const { spawn } = require("child_process");
const path = require("path");


const iconv = require("iconv-lite");

const FS = 0x1c;

// Encode ASCII normally and Japanese text using Shift-JIS.
// FS & enables Kanji mode; FS . cancels it.
function text(value = "") {
  const str = String(value);
  const chunks = [];
  const parts = str.split(/([^\x00-\x7F]+)/);

  for (const part of parts) {
    if (!part) continue;

    if (/[^\x00-\x7F]/.test(part)) {
      if (!iconv.encodingExists("shift_jis")) {
        throw new Error("Shift-JIS encoding is unavailable.");
      }

      chunks.push(Buffer.from([FS, 0x26])); // FS &
      chunks.push(iconv.encode(part, "shift_jis"));
      chunks.push(Buffer.from([FS, 0x2e])); // FS .
    } else {
      chunks.push(Buffer.from(part, "ascii"));
    }
  }

  return Buffer.concat(chunks);
}

const PRINTER_NAME = "POS-58C-USB";
const RECEIPT_WIDTH = 32;

const ESC = 0x1b;
const GS = 0x1d;

function command(...bytes) {
  return Buffer.from(bytes);
}

function line(value = "") {
  return Buffer.concat([text(value), Buffer.from([0x0a])]);
}

function displayWidth(value) {
  return Array.from(String(value)).reduce((width, char) => {
    return width + (char.codePointAt(0) > 0xff ? 2 : 1);
  }, 0);
}

function wrapText(value, maxWidth = RECEIPT_WIDTH) {
  const result = [];
  let current = "";
  let width = 0;

  for (const char of Array.from(String(value ?? ""))) {
    const charWidth = char.codePointAt(0) > 0xff ? 2 : 1;

    if (width + charWidth > maxWidth && current) {
      result.push(current);
      current = "";
      width = 0;
    }

    current += char;
    width += charWidth;
  }

  if (current || result.length === 0) {
    result.push(current);
  }

  return result;
}

function separator() {
  return line("-".repeat(RECEIPT_WIDTH));
}

function money(value) {
  return Math.round(Number(value) || 0).toLocaleString("en-US");
}

// Matches your buildOrderItems() output:
// { name, price, quantity, note, menu_item_id, added_at }
function itemLine(item) {
  const name = item.name ?? "Item";
  const quantity = Number(item.quantity) || 0;
  const price = Number(item.price) || 0;
  const amount = price * quantity;

  const chunks = [];

  for (const part of wrapText(name)) {
    chunks.push(line(part));
  }

  const detail = `  ${quantity} x ${money(price)}`;
  const amountText = money(amount);
  const spaces = Math.max(
    1,
    RECEIPT_WIDTH - displayWidth(detail) - amountText.length
  );

  chunks.push(line(detail + " ".repeat(spaces) + amountText));

  if (item.note && String(item.note).trim()) {
    for (const part of wrapText(`  Note: ${item.note}`)) {
      chunks.push(line(part));
    }
  }

  return chunks;
}

function itemRow(name, quantity, amount) {
  const left = `${name} x${quantity}`;
  const right = Number(amount).toFixed(0);

  const available = RECEIPT_WIDTH - right.length - 1;
  const trimmedLeft = left.slice(0, Math.max(0, available));

  return line(
    trimmedLeft +
    " ".repeat(Math.max(1, RECEIPT_WIDTH - trimmedLeft.length - right.length)) +
    right
  );
}

function buildTestReceipt() {
  const chunks = [];

  // Initialize printer.
  chunks.push(command(ESC, 0x40));

  // Centered, bold heading.
  chunks.push(command(ESC, 0x61, 0x01));
  chunks.push(command(ESC, 0x45, 0x01));
  chunks.push(line("SUMATRA RESTAURANT"));
  chunks.push(command(ESC, 0x45, 0x00));

  chunks.push(line("USB ESC/POS TEST"));
  chunks.push(line(new Date().toLocaleString("en-GB")));
  chunks.push(command(ESC, 0x61, 0x00));

  chunks.push(separator());
  chunks.push(line("Item                 Qty   Yen"));
  chunks.push(separator());

  chunks.push(itemRow("Test Product", 2, 1000));
  chunks.push(itemRow("Water", 1, 150));

  chunks.push(separator());

  chunks.push(command(ESC, 0x45, 0x01));
  chunks.push(line("TOTAL: JPY 1150"));
  chunks.push(command(ESC, 0x45, 0x00));

  chunks.push(line(""));
  chunks.push(command(ESC, 0x61, 0x01));
  chunks.push(line("Thank you!"));
  chunks.push(command(ESC, 0x61, 0x00));

  // Feed paper so the receipt is easy to tear off.
  chunks.push(command(ESC, 0x64, 0x03));

  // Enable only after confirming the cutter is supported.
  chunks.push(command(GS, 0x56, 0x41, 0x00));

  return Buffer.concat(chunks);
}

function buildOrderReceipt(order, options = {}) {
  const receiptItems = options.items ?? order.items ?? [];
  const heading = options.heading ?? "NEW ORDER";
  const chunks = [];

  // Initialize printer.
  chunks.push(Buffer.from([ESC, 0x40]));

  // Restaurant title and receipt heading.
  chunks.push(Buffer.from([ESC, 0x61, 0x01]));
  chunks.push(Buffer.from([ESC, 0x45, 0x01]));
  chunks.push(line("SUMATRA RESTAURANT"));
  chunks.push(Buffer.from([ESC, 0x45, 0x00]));
  chunks.push(line(heading));

  chunks.push(Buffer.from([ESC, 0x61, 0x00]));
  chunks.push(separator());
  chunks.push(line(`Table: ${order.table_number}`));
  chunks.push(line(`Order: ${String(order.id).slice(0, 12)}`));

  const orderTime = order.added_at
    ? new Date(order.added_at).toLocaleString("en-GB")
    : new Date().toLocaleString("en-GB");

  for (const part of wrapText(`Time: ${orderTime}`)) {
    chunks.push(line(part));
  }

  chunks.push(separator());

  for (const item of receiptItems) {
    chunks.push(...itemLine(item));
  }

  chunks.push(separator());

  chunks.push(Buffer.from([ESC, 0x45, 0x01]));
  chunks.push(line(`TOTAL: JPY ${money(order.total)}`));
  chunks.push(Buffer.from([ESC, 0x45, 0x00]));

  chunks.push(line(""));
  chunks.push(Buffer.from([ESC, 0x61, 0x01]));
  chunks.push(line("Thank you!"));
  chunks.push(Buffer.from([ESC, 0x61, 0x00]));

  // Keep the cut command that worked on your printer.
  chunks.push(Buffer.from([GS, 0x56, 0x41, 0x00]));

  // Feed paper and cut.
  chunks.push(Buffer.from([0x1d, 0x56, 0x41, 0x00]));

  return Buffer.concat(chunks);
}

async function printOrderReceipt(order, options = {}) {
  return printRaw(buildOrderReceipt(order, options));
}

function printRaw(data, printerName = PRINTER_NAME) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "print-raw.ps1");

    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        printerName,
      ],
      { windowsHide: true }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", chunk => {
      stdout += chunk;
    });

    child.stderr.on("data", chunk => {
      stderr += chunk;
    });

    child.on("error", reject);

    child.on("close", code => {
      if (code !== 0) {
        reject(
          new Error(
            `RAW printing failed (exit ${code}).\n${stderr || stdout}`
          )
        );
        return;
      }

      resolve(stdout.trim() || "Print job submitted.");
    });

    // Send the ESC/POS bytes to PowerShell over stdin.
    child.stdin.end(data.toString("base64"), "utf8");
  });
}

async function printTestReceipt() {
  return printRaw(buildTestReceipt());
}

async function printJapaneseTest() {
  const testOrder = {
    id: "test-japanese-001",
    table_number: 5,
    start_time: new Date().toISOString(),
    total: 1000,
    items: [
      {
        name: "Sashimi (刺身)",
        price: 500,
        quantity: 2,
        note: "わさび少なめ",
      },
    ],
  };

  return printOrderReceipt(testOrder);
}

module.exports = {
  printRaw,
  printTestReceipt,
  printOrderReceipt,
  printJapaneseTest
};
