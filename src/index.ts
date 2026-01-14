import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
	BFL_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors());

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
			return c.json({ error: 'No polling URL returned from BFL API' }, 500);
		}

		const maxAttempts = 45;
		const delayMs = 1000;
		let attempts = 0;
		let data: any;

		while (attempts < maxAttempts) {
			const response = await fetch(imageUrl);

			if (!response.ok) {
				return c.json({ error: 'Failed to fetch polling status' }, 500);
			}

			data = await response.json();
			attempts++;

			console.log(`Poll attempt ${attempts}: status = ${data.status}`);

			if (data.status === 'Ready') {
				break;
			}

			if (data.status === 'Pending') {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
				continue;
			}

			return c.json({ error: `Unexpected status: ${data.status}` }, 500);
		}

		if (attempts >= maxAttempts) {
			return c.json(
				{
					error: 'Image processing timed out after multiple attempts',
				},
				500
			);
		}

		if (data.status !== 'Ready') {
			return c.json(
				{
					error: `Image processing failed with status: ${data.status}`,
				},
				500
			);
		}

		const imageSampleUrl = data.result?.sample || data.sample;

		if (!imageSampleUrl) {
			console.log('Data structure:', data);
			return c.json({ error: 'No image URL in result' }, 500);
		}

		console.log(`Success after ${attempts} attempts`);
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
			generateAndGet: 'POST /api/generate with form-data {prompt: string, image: file, width?: number, height?: number}',
			generate: 'POST /api/create with form-data {prompt: string, image: file, width?: number, height?: number}',
			get_image: 'POST /api/getImage with JSON {imageUrl: string}',
		},
	});
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
		const width = formData['width'] as string;
		const height = formData['height'] as string;

		console.log('original prompt:', prompt);

		var imageWidth = parseInt(width) || 1024;
		var imageHeight = parseInt(height) || 1024;
		var imagePrompt = prompt;

		if (!prompt) {
			imagePrompt = `[photo reference 1] people with minimal cybernetic enhancements: Illuminated seam detailing on jacket collar reacting to ambient light, Subtle holographic data stream projection floating around the person. Background from [photo reference 2] (text removed) with cyberpunk color grading, Photorealistic, sci-fi. take inspiration from [photo reference 3]`;
		}

		if (!imageFile || !(imageFile instanceof File)) {
			return c.json({ error: 'Image file required' }, 400);
		}

		const imageBuffer = await imageFile.arrayBuffer();
		const base64Image = arrayBufferToBase64(imageBuffer);

		const bflRequest = {
			prompt: prompt,
			input_image: base64Image,
			input_image_2: 'https://storage.googleapis.com/eva-assets/aignite_2.jpg',
			input_image_3: 'https://storage.googleapis.com/eva-assets/aignite_3.webp',
			seed: 1,
			width: imageWidth,
			height: imageHeight,
			safety_tolerance: 4,
			output_format: 'jpeg',
		};

		const bflResponse = await fetch('https://api.bfl.ai/v1/flux-2-pro', {
			method: 'POST',
			headers: {
				'x-key': apiKey,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(bflRequest),
		});

		if (!bflResponse.ok) {
			const error = await bflResponse.text();
			return c.json({ error: `BFL API error: ${error}` }, 500);
		}

		const bflResult: any = await bflResponse.json();
		const imageUrl = bflResult.polling_url;

		if (!imageUrl) {
			return c.json({ error: 'No polling URL returned from BFL API' }, 500);
		}

		const maxAttempts = 30;
		const delayMs = 1000;
		let attempts = 0;
		let data: any;

		await new Promise((resolve) => setTimeout(resolve, 20_000));
		while (attempts < maxAttempts) {
			const response = await fetch(imageUrl);

			if (!response.ok) {
				return c.json({ error: 'Failed to fetch polling status' }, 500);
			}

			data = await response.json();
			attempts++;

			console.log(`Poll attempt ${attempts}: status = ${data.status}`);

			if (data.status === 'Ready') {
				break;
			}

			if (data.status === 'Pending') {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
				continue;
			}

			return c.json({ error: `Unexpected status: ${data.status}` }, 500);
		}

		if (attempts >= maxAttempts) {
			return c.json(
				{
					error: 'Image processing timed out after multiple attempts',
				},
				500
			);
		}

		if (data.status !== 'Ready') {
			return c.json(
				{
					error: `Image processing failed with status: ${data.status}`,
				},
				500
			);
		}

		console.log({ bflResult, data });

		const imageSampleUrl = data.result?.sample || data.sample;

		if (!imageSampleUrl) {
			console.log('Data structure:', data);
			return c.json({ error: 'No image URL in result' }, 500);
		}

		console.log(`Success after ${attempts} attempts`);
		const aiResponse = await fetch(imageSampleUrl);

		const aiBlob = await aiResponse.blob();
		const headers = {
			'Content-Type': aiResponse.headers.get('Content-Type') || 'image/jpeg',
		};

		return c.body(await aiBlob.arrayBuffer(), 200, headers);
	} catch (error: any) {
		console.error('Error in image generation:', error);
		return c.json(
			{
				message: 'failed to generate Image',
				error: error.message,
			},
			500
		);
	}
});
export default app;
