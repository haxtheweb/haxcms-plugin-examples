// Fails ESLint: optional chaining is banned in HAX code, and an unused variable.
export default {
  hooks: {
    "page.before.save"(ctx, page) {
      const unused = 1;
      return page?.title;
    },
  },
};
