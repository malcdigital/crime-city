// The city's gun shops: who runs each, what they stock and what they charge. Where they are:
// districts.js GUN_SHOP_BLOCKS (same order). Inside: src/interiors.js (the store and its range).
//   stock: what's on the racks (WEAPONS ids, src/weapons.js); mult: their prices against the
//   list (shops.js GUN_STOCK); clerk: who's behind the counter, how he looks and talks.
export const GUN_SHOPS = [
  {
    key: 'mike', name: "Iron Mike's Guns", sign: "IRON MIKE'S GUNS", signBg: '#8e1b10', district: 'Midtown',
    stock: ['pistol', 'revolver', 'smg', 'shotgun', 'rifle'], mult: 1,
    look: { walls: 0x6e5a48, floor: 0x7d6a55, trim: 0x3b2a1e },
    clerk: {
      name: 'Iron Mike', height: 1.9, look: { shirt: 0x4e5b31, pants: 0x2b2b2b, skin: 0xe0ac69, cap: 0x2b2b2b },
      hi: ["What you need, young blood?", "Back again. What we working with?", "Look but don't touch. Ask me first."],
      bought: ["Good choice. Treat her right.", "That's a solid piece.", "Pleasure doing business."],
      bye: ["Stay safe out there.", "Don't do nothing I wouldn't do.", "Come back when you need more."],
    },
  },
  {
    key: 'downtown', name: 'Downtown Arms', sign: 'DOWNTOWN ARMS', signBg: '#1d3557', district: 'Downtown',
    stock: ['pistol', 'revolver', 'mpistol', 'smg', 'rifle', 'hunting'], mult: 1.15,
    look: { walls: 0x8a9099, floor: 0x5d636b, trim: 0x1d3557 },
    clerk: {
      name: 'Rosa', female: true, height: 1.68, look: { shirt: 0x1d3557, pants: 0x1b1b1b, skin: 0xa86b3c, hair: 0x1a1a1a, hairStyle: 'bun' },
      hi: ['Welcome to Downtown Arms. Anything catch your eye?', 'Hey. Take your time, everything on the wall is for sale.', 'What can I do for you today?'],
      bought: ['Excellent choice. The range is in the back if you want to try it.', "You're all set.", 'Enjoy it. Responsibly.'],
      bye: ['Have a good one.', 'Come back anytime.', 'Take care out there.'],
    },
  },
  {
    key: 'lucky', name: "Lucky's Pawn & Guns", sign: "LUCKY'S PAWN & GUNS", signBg: '#7a5c00', district: 'The Strip',
    stock: ['pistol', 'mpistol', 'revolver', 'shotgun'], mult: 0.85,
    look: { walls: 0x7a6a3a, floor: 0x5b4a2c, trim: 0x2e2410 },
    clerk: {
      name: 'Lucky', height: 1.74, look: { shirt: 0x9c2b2b, pants: 0x3a3a3a, skin: 0x8d5524, cap: 0xd4a017 },
      hi: ["Ayy, what's good? Everything's negotiable. Not really.", "You buying or browsing? Either way, don't touch the glass.", "Lucky's got what you need, no questions."],
      bought: ['No refunds, no receipts.', "That one's got a story. Don't ask.", "Lucky's always looks out."],
      bye: ['Be easy.', "You ain't get it from me.", 'Stay lucky.'],
    },
  },
  {
    key: 'docks', name: 'Dockside Firearms', sign: 'DOCKSIDE FIREARMS', signBg: '#24543b', district: 'The Docks',
    stock: ['smg', 'shotgun', 'rifle', 'ak', 'hunting'], mult: 1,
    look: { walls: 0x5b6b5e, floor: 0x5a5a52, trim: 0x24543b },
    clerk: {
      name: 'Hank', height: 1.85, look: { shirt: 0x37474f, pants: 0x2f3b45, skin: 0xd8a47f, cap: 0x24543b },
      hi: ['Heavy stuff only down here. What you looking for?', "Long guns on the wall. Ask if you want to see one.", "Yeah? What'll it be?"],
      bought: ["She'll do the job.", 'Good iron. Range is out back.', "Don't point it at nothing you ain't ready to lose."],
      bye: ['Watch yourself.', 'See you around.', 'Later.'],
    },
  },
];
