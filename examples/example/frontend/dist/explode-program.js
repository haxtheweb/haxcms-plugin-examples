// Merlin program factory: createXProgram(context) returns async (input, values) => MerlinOption[]
export function createExplodeProgram(context) {
  return async (input, values) => {
    const count = Math.max(1, parseInt(input, 10) || 1);
    return [
      {
        title: `Add ${count} explosion${count === 1 ? "" : "s"}`,
        icon: "icons:flare",
        tags: ["confirm"],
        eventName: "hax-super-daemon-insert-tag",
        path: "HAX/action/explode/confirm",
        value: { tag: "awesome-explosion", properties: { intensity: count } },
      },
    ];
  };
}
export default createExplodeProgram;
