import fs from 'node:fs';
import postcss from 'postcss';

// The v4 sibling selector changes margin/border sides. Preserve established v3
// selectors only for existing utilities; new classes keep native v4 behavior.
const source = fs.readFileSync(new URL('./tailwind-v3-spacing.css', import.meta.url), 'utf8');
const classes = new Set();
postcss.parse(source).walkRules(rule => {
  for (const match of rule.selector.matchAll(/\.((?:space|divide)-[xy](?:-[\w.]+)?)(?=[>:])/g)) classes.add(match[1]);
});
export default function spacingCompatibility() {
  return {
    postcssPlugin: 'fullpassword-v3-spacing-compat',
    OnceExit(root) {
      root.walkRules(rule => {
        const firstClass = /^\.((?:space|divide)-[xy](?:-[\w.]+)?)(?=[>{:\s]|$)/.exec(rule.selector);
        if (firstClass && classes.has(firstClass[1])) rule.remove();
      });
      root.append(postcss.parse(source));
    }
  };
}
