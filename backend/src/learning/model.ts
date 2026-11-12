/** A bounded, CPU-only online logistic ranker; no model runtime or GPU needed. */
export const featureCount = 2048;
export type Vector = Record<string, number>;
export type LocalModel = {weights: Vector; bias: number; examples: number};

export function normalizeQuery(text: string): string {
	return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
		.replace(/\b(?:launch|start|mo)\b/g, 'open')
		.replace(/\b(?:find|tim)\b/g, 'search')
		.replace(/\b(?:enter|fill|nhap)\b/g, 'type')
		.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ').slice(0, 4096);
}

function hash(text: string): number {
	let value = 2166136261;
	for (const character of text) {
		// FNV-1a intentionally uses 32-bit integer arithmetic.
		// eslint-disable-next-line no-bitwise
		value ^= character.codePointAt(0)!;
		value = Math.imul(value, 16777619);
	}

	// eslint-disable-next-line no-bitwise
	return (value >>> 0) % featureCount;
}

export function features(query: string): Vector {
	const text = normalizeQuery(query);
	const vector: Vector = {};
	const add = (feature: string, weight: number) => {
		const key = String(hash(feature));
		vector[key] = (vector[key] ?? 0) + weight;
	};

	for (const token of text.split(' ').filter(Boolean).slice(0, 128)) {
		add(`word:${token}`, 3);
		const padded = `^${token}$`;
		for (let index = 0; index < padded.length - 2; index++) {
			add(`gram:${padded.slice(index, index + 3)}`, 1);
		}
	}

	const norm = Math.sqrt(Object.values(vector).reduce((sum, value) => sum + (value * value), 0)) || 1;
	for (const key of Object.keys(vector)) {
		vector[key] = (vector[key] ?? 0) / norm;
	}

	return vector;
}

export function similarity(first: Vector, second: Vector, keys = Object.keys(first)): number {
	let sum = 0;
	for (const key of keys) {
		sum += first[key]! * (second[key] ?? 0);
	}

	return sum;
}

export function predict(model: LocalModel, vector: Vector, keys = Object.keys(vector)): number {
	const logit = Math.max(-20, Math.min(20, model.bias + similarity(vector, model.weights, keys)));
	return 1 / (1 + Math.exp(-logit));
}

export function train(model: LocalModel, vector: Vector, label: 0 | 1): void {
	const keys = Object.keys(vector);
	const gradient = (label - predict(model, vector, keys)) * 0.4;
	for (const key of keys) {
		model.weights[key] = ((model.weights[key] ?? 0) * 0.999) + (gradient * vector[key]!);
	}

	model.bias = Math.max(-4, Math.min(4, model.bias + gradient));
	model.examples += 1;
}
