import { Hono } from 'hono';
import { count } from 'node:console';
import { json } from 'node:stream/consumers';
import test from 'node:test';

type Bindings = {
	BFL_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', async (c, next) => {
	c.header('Access-Control-Allow-Origin', '*');
	await next();
});

app.post('/api/generate', async (c) => {
	try {
		const apiKey = c.env.BFL_API_KEY;

		if (!apiKey) {
			return c.json({ error: 'API key missing' }, 500);
		}

		const formData = await c.req.parseBody();
		const prompt = formData['prompt'] as string;
		const imageFile = formData['image'] as File;

		if (!prompt) {
			return c.json({ error: 'Prompt required' }, 400);
		}

		if (!imageFile || !(imageFile instanceof File)) {
			return c.json({ error: 'Image file required' }, 400);
		}

		const imageBuffer = await imageFile.arrayBuffer();
		const base64 = arrayBufferToBase64(imageBuffer);

		const bflRequest = {
			prompt: prompt,
			input_image: base64,
			seed: 1,
			width: 512,
			height: 512,
			safety_tolerance: 0,
			output_format: 'jpeg',
		};

		const response = await fetch('https://api.bfl.ai/v1/flux-2-pro', {
			method: 'POST',
			headers: {
				'x-key': apiKey,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(bflRequest),
		});

		if (!response.ok) {
			const error = await response.text();
			return c.json({ error: `BFL API error: ${error}` }, 500);
		}

		const result = await response.json();

		return c.json({
			success: true,
			result: result,
			prompt: prompt,
			timestamp: new Date().toISOString(),
		});
	} catch (error: any) {
		return c.json({ error: error.message }, 500);
	}
});

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

app.post('/api/getImage', async (c) => {
	try {
		const { imageUrl } = await c.req.json();

		if (!imageUrl) {
			return c.json({ error: 'Image URL is required' }, 400);
		}

		const response = await fetch(imageUrl);

		if (!response.ok) {
			return c.json({ error: 'Failed to fetch image' }, 500);
		}

		const data: any = await response.json();

		let counter = 1;
		while (data.status === 'Pending') {
			await fetch(imageUrl);
			console.log(counter++);
			if (counter == 10) {
				break;
			}
		}

		if (data.status === 'Pending') {
			return c.json({ error: 'Image processing is pending' }, 500);
		}

		const imageSampleUrl = data.result.sample;

		return c.json({ image: imageSampleUrl });
	} catch (error: any) {
		console.error('Error fetching image:', error);
		return c.json(
			{
				error: 'Failed to process image request',
				details: error.message,
			},
			500
		);
	}
});

app.get('/', (c) => {
	return c.json({
		message: 'BFL Image API',
		endpoints: {
			upload: 'POST /api/generate with form-data {prompt: string, image: file}',
			get_image: 'POST /api/getImage with JSON {imageUrl: string}',
		},
	});
});

export default app;
