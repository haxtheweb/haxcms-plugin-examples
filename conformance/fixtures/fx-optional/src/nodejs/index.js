// a record that happens to have status and body fields is a body, not a response envelope
export default { operations: { async fxOptionalThing(ctx) { return { status: ctx.user ? "member" : "visitor", body: "text" }; } } };
