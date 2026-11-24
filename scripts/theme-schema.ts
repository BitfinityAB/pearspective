import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ThemeFileSchema } from '../shared/themeSchema';

/** The JSON Schema editors use to autocomplete and check theme files. */
export function themeJsonSchema(): object {
  return { title: 'Pearspective theme', ...z.toJSONSchema(ThemeFileSchema, { target: 'draft-2020-12' }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync('themes/theme.schema.json', `${JSON.stringify(themeJsonSchema(), null, 2)}\n`);
}
