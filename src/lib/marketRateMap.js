// Maps common vegetable names (Tamil) to their exact Agmarknet commodity
// name, so purchase rates can be compared against Tamil Nadu mandi prices.
//
// DELIBERATELY LIMITED SCOPE: only items that are reliably sold BY WEIGHT in
// mandis are included. The Agmarknet dataset has no unit field -- it assumes
// price-per-quintal for every row, which breaks down for items commonly sold
// by bunch/count (banana, coconut, leafy greens, drumstick, etc.). Including
// those produces meaningless gap percentages, so they're intentionally left
// out rather than shown with a misleading comparison.
//
// Koyambedu itself does not report into this dataset; the serverless function
// checks Koyambedu first and falls back to any other reporting Tamil Nadu
// market, labelling the result "(not Koyambedu)" so the source is never hidden.
export const MARKET_RATE_MAP = [
  { commodity: 'Onion', match: ['வெங்காயம்'] },
  { commodity: 'Tomato', match: ['தக்காளி'] },
  { commodity: 'Potato', match: ['உருளைக்கிழங்கு', 'உருளை'] },
  { commodity: 'Brinjal', match: ['கத்தரிக்காய்', 'கத்தரி'] },
  { commodity: 'Cabbage', match: ['முட்டைக்கோஸ்', 'கோஸ்'] },
  { commodity: 'Carrot', match: ['கேரட்'] },
  { commodity: 'Beans', match: ['பீன்ஸ்'] },
  { commodity: 'Bhindi(Ladies Finger)', match: ['வெண்டைக்காய்', 'வெண்டை'] },
  { commodity: 'Bitter gourd', match: ['பாகற்காய்'] },
  { commodity: 'Snakeguard', match: ['புடலங்காய்'] },
  { commodity: 'Ridgeguard(Tori)', match: ['பீர்க்கங்காய்'] },
  { commodity: 'Ashgourd', match: ['பூசணிக்காய்'] },
  { commodity: 'Pumpkin', match: ['பரங்கிக்காய்'] },
  { commodity: 'Raddish', match: ['முள்ளங்கி'] },
  { commodity: 'Beetroot', match: ['பீட்ரூட்'] },
  { commodity: 'Cauliflower', match: ['காலிஃபிளவர்'] },
  { commodity: 'Cucumbar(Kheera)', match: ['வெள்ளரிக்காய்', 'வெள்ளரி'] },
  { commodity: 'Ginger(Green)', match: ['இஞ்சி'] },
  { commodity: 'Garlic', match: ['பூண்டு'] },
  { commodity: 'Green Chilli', match: ['பச்சை மிளகாய்', 'மிளகாய்'] },
  { commodity: 'Sweet Potato', match: ['சக்கரைவள்ளிக் கிழங்கு'] },
  { commodity: 'Colacasia', match: ['சேப்பங்கிழங்கு'] },
  { commodity: 'Cluster beans', match: ['கொத்தவரங்காய்'] },
  { commodity: 'Tapioca', match: ['மரவள்ளிக்கிழங்கு'] },
  { commodity: 'Green Peas', match: ['பட்டாணி'] },
  { commodity: 'Chow Chow', match: ['சவ்வரிசி', 'சௌசௌ'] },
  { commodity: 'Turnip', match: ['டர்னிப்'] },

  // Excluded on purpose (commonly sold by bunch/count/piece, not weight,
  // so a ₹/kg comparison would be misleading): banana, coconut, tender
  // coconut, drumstick, coriander leaves, mint leaves, curry leaves,
  // amaranthus/other leafy greens, betel leaves, flowers.
];

// Given an ingredient name, return the matching Agmarknet commodity name, or null.
export function resolveCommodity(name) {
  const n = String(name || '');
  for (const entry of MARKET_RATE_MAP) {
    if (entry.match.some((m) => n.includes(m))) return entry.commodity;
  }
  return null;
}
