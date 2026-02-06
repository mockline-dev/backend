
import { Application } from '../../../back/src/declarations';
import { hashFileName } from './hashFileName';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

export default async function uploadFileMultipart(app: Application,file: File, setUploadProgress?: (progress: number) => void): Promise<string | null> {
    try {
        const hashedFilename = await hashFileName(file.name);
        const initResponse = await app.service('uploads').create({
            key: hashedFilename,
            contentType: file.type
        });
        const { uploadId, key } = initResponse;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const parts = [];

        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(file.size, start + CHUNK_SIZE);
            const chunk = file.slice(start, end);

            const reader = new FileReader();
            const chunkData = await new Promise<ArrayBuffer>((resolve) => {
                reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
                reader.readAsArrayBuffer(chunk);
            });

            const partResponse = await app.service('uploads').patch(null, {
                partNumber: i + 1,
                uploadId,
                key,
                content: Buffer.from(chunkData)
            });
            const responseETag =
                Array.isArray(partResponse) && partResponse.length > 0
                    ? (partResponse[0] as unknown as { ETag: string; PartNumber: number })?.ETag || ''
                    : (partResponse as unknown as { ETag: string; PartNumber: number })?.ETag || '';

            parts.push({
                ETag: responseETag,
                PartNumber: i + 1
            });

            if (setUploadProgress) {
                setUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
            }
        }

        const completeResponse = await app.service('uploads').update(null, {
            uploadId,
            key,
            parts,
            fileType: file.type
        });
        return (completeResponse as unknown as string) || null;
    } catch (error) {
        throw error;
    }
}
