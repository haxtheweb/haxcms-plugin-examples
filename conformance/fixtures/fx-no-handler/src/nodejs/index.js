// handles page.after.save in Node; the PHP class forgot it (a validator case)
export default { hooks: { "page.after.save": async () => {} } };
