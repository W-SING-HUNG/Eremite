import JSZip from "jszip";

export function makePdfFixture(label = "Eremite Viewer", pageCount = 1) {
  const safePageCount = Math.max(1, Math.min(10, Math.trunc(pageCount)));
  const fontObjectId = 3 + safePageCount * 2;
  const pageObjectIds = Array.from({ length: safePageCount }, (_, index) => 3 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${safePageCount} >>`,
  ];
  for (let index = 0; index < safePageCount; index += 1) {
    const stream = `BT /F1 20 Tf 72 720 Td (${escapePdfText(`${label} - Page ${index + 1}`)}) Tj ET`;
    const pageObjectId = pageObjectIds[index];
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${pageObjectId + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, "ascii");
}

export const encryptedPdfFixture = () => Buffer.from("JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDVjNTI3Y2UzYmI+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCA2MTIgNzkyIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8YTc2MmMyNDQ3OTdhYTI4NjhhOTcwZjJkOWQ3YTA2NzQ4YThmZGVlMTU1ZjcyOWJhNjZmNzk2ODFhNjUwZDIzMz4KL1UgPDAxNThlZjgwNTM3NTg2MWNhNGMwNWEzOTg0NTcyNWRjMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwIG4gCjAwMDAwMDAxMTggMDAwMDAgbiAKMDAwMDAwMDE2NyAwMDAwMCBuIAowMDAwMDAwMjYxIDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNgovUm9vdCAzIDAgUgovSW5mbyAxIDAgUgovSUQgWyA8MzU2MTMxMzI2MjM3NjQzNzM4MzU2MTM2NjQzNTM1MzczNTM2Mzk2MjYyMzczMDY0MzIzNDMyMzI2MTM3MzAzOT4gPDM1NjEzMTMyNjIzNzY0MzczODM1NjEzNjY0MzUzNTM3MzUzNjM5NjI2MjM3MzA2NDMyMzQzMjMyNjEzNzMwMzk+IF0KL0VuY3J5cHQgNSAwIFIKPj4Kc3RhcnR4cmVmCjQ3NgolJUVPRgo=", "base64");

export async function makeDocxFixture(label = "Eremite Viewer DOCX") {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escapeXml(label)}</w:t></w:r></w:p><w:p><w:r><w:t>Read-only document fixture.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

export async function makeZipFixture() {
  const zip = new JSZip();
  zip.file("README.txt", "Eremite archive fixture");
  zip.file("notes/daily.txt", "A nested file");
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

export function makeOversizedPngHeader(width = 50_001, height = 1_001) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8; bytes[25] = 2;
  return bytes;
}

export const imageFixtures = {
  png: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAIAAADBrGu+AAAAg0lEQVR4nO3ZIRLCUBAE0U4Xp8gRcNwK9TlLonJcLCIOEfoXz63bqhm1u6yPO2USJ3ESd/scxvakYH8d8yQgM1XoNKPfMc4ank9A4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4iRO4mTKy9yIXHmZIAGJW/4/sotJnFcv8K03fVMIpqUHYAkAAAAASUVORK5CYII=", "base64"),
  jpg: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAoAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyX4ceCovF0GqTz6ymlw6csbySPCHXawckkllCgBOvvW7/AMK28K/9FQ0X8ov/AI9R8Hv+RG+IH/YMH/oqevMax96UmkzyPelJpM9O/wCFbeFf+ioaL+UX/wAeo/4Vt4V/6Khov5Rf/Hq8xoquSX8w+SX8x6d/wrbwr/0VDRfyi/8Aj1H/AArbwr/0VDRfyi/+PV5jRRyS/mDkl/Menf8ACtvCv/RUNF/KL/49WF8R/BUXhGDS54NZTVIdRWR45EhCLtUIQQQzBgQ/X2rjq9O+MP8AyI3w/wD+wYf/AEVBU+9GSTYvejJJsPg9/wAiN8QP+wYP/RU9eY16d8Hv+RG+IH/YMH/oqevMaqHxSHD4pBRRRWhoFFFFABXp3xh/5Eb4f/8AYMP/AKKgrzGvTvjD/wAiN8P/APsGH/0VBWc/iiZz+KJhfDjxrF4Rg1SCfRk1SHUVjSSN5gi7VDgggqwYEP09q3f+Fk+Ff+iX6L+cX/xmiim6cW7sbpxbuw/4WT4V/wCiX6L+cX/xmj/hZPhX/ol+i/nF/wDGaKKXsoi9lEP+Fk+Ff+iX6L+cX/xmj/hZPhX/AKJfov5xf/GaKKPZRD2UQ/4WT4V/6Jfov5xf/GawviP41i8XQaXBBoyaXDpyyJHGkwddrBAAAFUKAE6e9FFNU4p3Q1TindH/2Q==", "base64"),
  webp: Buffer.from("UklGRtQAAABXRUJQVlA4IMgAAADwBgCdASpAACgAPkUeikQioiEdWmwAKAREs4BnKNV7YDcAf//fAN5aAZCDPeHF7J/OqNsLjNhrFRwGc/aozl1AAP792bH/a2KZe1zbzG9NxpqfjzeBO1YAmtoPJgXU4h/yQfTvv9dktGg/DbRNFp6Adx81zn8BUiJOZ2vt//YnPFb+Szk2yKyaK70BBlYnYQmrf0ZNTVpJMZlMXMx/jnKZthlHa8oXiPYp44KjIk0c/VE8x/GN51UCx7Gmgn6U0d/deBdweAAAAA==", "base64"),
};

export const makeLongTextFixture = () => Buffer.from(Array.from({ length: 20_000 }, (_, index) => `${String(index + 1).padStart(5, "0")}  Eremite long text fixture - continuous reading and wrapping.\n`).join(""));
export const makeLongMarkdownFixture = (sections = 600) => Buffer.from(`# Long Markdown Fixture\n\n${Array.from({ length: sections }, (_, index) => `## Section ${index + 1}\n\n- Quick Preview\n- Full Viewer\n\nA long but safe local-first document paragraph.\n`).join("\n")}`);

const escapePdfText = (value) => value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
const escapeXml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
