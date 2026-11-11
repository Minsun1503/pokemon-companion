import {z} from 'zod';

/** The SDK advertises only object schemas. Preserve union validation behind a discoverable object. */
export function mcpObjectSchema(schema: z.ZodType): z.ZodObject {
	if (schema instanceof z.ZodObject) {
		return schema;
	}

	if (!(schema instanceof z.ZodDiscriminatedUnion)) {
		throw new Error('Tool schema must be an object or discriminated object union.');
	}

	const branches = schema.options as z.ZodObject[];
	const keys = new Set(branches.flatMap((branch) => Object.keys(branch.shape)));
	const shape: Record<string, z.ZodType> = {};
	for (const key of keys) {
		const fields = [...new Set(branches.flatMap((branch) => branch.shape[key] ? [branch.shape[key] as z.ZodType] : []))];
		const common = branches.every((branch) => Boolean(branch.shape[key]));
		const variants = common ? fields : fields.map((field) => field instanceof z.ZodDefault ? field.unwrap() : field);
		const field = (variants.length === 1 ? variants[0]! : z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]])) as z.ZodType;
		shape[key] = common ? field : field.optional();
	}

	return z.object(shape).strict().superRefine((input, context) => {
		const parsed = schema.safeParse(input);
		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				context.addIssue({...issue});
			}
		}
	});
}
