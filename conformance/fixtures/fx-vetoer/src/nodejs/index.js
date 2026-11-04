// Vetoes any page or file whose title or name contains "forbidden", so plugins can test how they report vetoes.
const no = (ctx) => /forbidden/i.test(String((ctx.subject && (ctx.subject.title || ctx.subject.name)) || "")) ? ctx.veto("fx-vetoer: forbidden") : ctx.subject;
export default { hooks: { "page.before.save": no, "page.before.delete": no, "file.before.save": no, "file.before.delete": no } };
