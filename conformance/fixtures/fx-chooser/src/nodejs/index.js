// A chosen importer: one page per uploaded text file, titled by the file name. Proves what the choosers list.
export default { contracts: { "import.platform": { async convert(ctx, input) {
  const files = (input && Array.isArray(input.files)) ? input.files : [];
  if (!files.length) return { error: "upload a .txt file" };
  const items = files.map((f, i) => ({ id: `item-${i + 1}`, title: String(f.name).replace(/\.txt$/, ""), slug: `page-${i + 1}`, parent: null, order: i, content: `<p>${Buffer.from(String(f.data), "base64").toString("utf8")}</p>` }));
  return { title: "Chosen", items };
} } } };
