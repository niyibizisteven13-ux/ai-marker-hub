export const downloadFile = (
  fileUrl: string | undefined,
  base64Data: string | undefined,
  fileName: string,
  mimeType?: string,
) => {
  if (!fileUrl && !base64Data) {
    console.error('No file data available for download.');
    return;
  }

  let downloadUrl = fileUrl;

  if (!downloadUrl && base64Data) {
    const type = mimeType || 'application/octet-stream';
    downloadUrl = `data:${type};base64,${base64Data}`;
  }

  if (downloadUrl) {
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};