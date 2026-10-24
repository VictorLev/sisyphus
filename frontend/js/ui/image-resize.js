// Shrinks a picture before it's uploaded: at most `maxWidth` wide, as a
// JPEG. A phone photo of several MB becomes ~100-200 kB, plenty for a card.

export async function shrinkImage(file, maxWidth = 960, quality = 0.85) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not read that picture'))), 'image/jpeg', quality);
  });
}
