import assert from "node:assert/strict";
import ExcelJS from "exceljs";

const source = new ExcelJS.Workbook();
const sheet = source.addWorksheet("靠浦导入导出验证");
sheet.columns = [
  { header: "课程", key: "course", width: 16 },
  { header: "价格", key: "price", width: 12 },
];
sheet.addRow({ course: "CPT111", price: 19.9 });
sheet.getCell("B2").numFmt = "¥0.00";

const payload = await source.xlsx.writeBuffer();
assert.ok(payload.byteLength > 0, "XLSX 导出结果不能为空");

const restored = new ExcelJS.Workbook();
await restored.xlsx.load(payload);
const restoredSheet = restored.getWorksheet("靠浦导入导出验证");
assert.ok(restoredSheet, "XLSX 工作表必须可恢复");
assert.equal(restoredSheet.getCell("A2").value, "CPT111");
assert.equal(restoredSheet.getCell("B2").value, 19.9);
assert.equal(restoredSheet.getCell("B2").numFmt, "¥0.00");

console.log(JSON.stringify({
  ok: true,
  bytes: payload.byteLength,
  worksheet: restoredSheet.name,
}));
