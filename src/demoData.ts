import { LegoSet } from './types';

export const DEMO_SETS: LegoSet[] = [
  {
    id: 'demo-1',
    userId: 'demo-user',
    setNumber: '10305',
    name: "Lion Knights' Castle",
    legoPriceHuf: 154990,
    productImage: 'https://sh-s7-live-s.legocdn.com/is/image/LEGO/10305_alt1?wid=1024&qlt=90,0&resMode=sharp&op_usm=1,1,0,0',
    legoUrl: 'https://www.lego.com/en-hu/product/lion-knights-castle-10305',
    status: 'ordered',
    priority: 'high',
    createdAt: new Date('2024-01-10').toISOString(),
    updatedAt: new Date('2024-01-10').toISOString(),
    hasFetchedLegoInfo: true,
    isTemporary: false,
    releaseDate: null,
    orderedDate: '2024-02-14',
    orderedPriceHuf: 130000,
    orderedCurrency: 'HUF',
    quantity: 1,
    marketPrices: {
       amazon: { price: 349.99, priceEur: 349.99, priceHuf: 138000, store: 'Amazon EU' },
       exchangeRate: 395
    }
  },
  {
    id: 'demo-2',
    userId: 'demo-user',
    setNumber: '71047',
    name: 'Dungeons & Dragons®',
    legoPriceHuf: 1690,
    productImage: 'https://sh-s7-live-s.legocdn.com/is/image/LEGO/71047',
    legoUrl: 'https://www.lego.com/en-hu/product/dungeons-dragons-71047',
    status: 'planned',
    priority: 'medium',
    createdAt: new Date('2024-02-15').toISOString(),
    updatedAt: new Date('2024-09-01').toISOString(),
    hasFetchedLegoInfo: true,
    isTemporary: false,
    releaseDate: null,
    minifigures: [
       { id: '71047-1', name: 'Dwarf Cleric', image: 'https://sh-s7-live-s.legocdn.com/is/image/LEGO/71047_alt1' },
       { id: '71047-2', name: 'Elf Bard', image: 'https://sh-s7-live-s.legocdn.com/is/image/LEGO/71047_alt2' },
       { id: '71047-3', name: 'Tiefling Sorcerer', image: 'https://sh-s7-live-s.legocdn.com/is/image/LEGO/71047_alt3' }
    ]
  },
  {
    id: 'demo-3',
    userId: 'demo-user',
    setNumber: '21348',
    name: "Dungeons & Dragons: Red Dragon's Tale",
    legoPriceHuf: 144990,
    productImage: 'https://sh-s7-live-s.legocdn.com/is/image/LEGO/21348_alt1?wid=1024&qlt=90,0&resMode=sharp&op_usm=1,1,0,0',
    legoUrl: 'https://www.lego.com/en-hu/product/dungeons-dragons-red-dragon-s-tale-21348',
    status: 'planned',
    priority: 'high',
    createdAt: new Date('2024-04-01').toISOString(),
    updatedAt: new Date('2024-04-01').toISOString(),
    hasFetchedLegoInfo: true,
    isTemporary: false,
    releaseDate: null,
    marketPrices: {
       amazon: { price: 320.00, priceEur: 320.00, priceHuf: 126400, store: 'Amazon EU' },
       exchangeRate: 395
    }
  },
  {
    id: 'demo-4',
    userId: 'demo-user',
    setNumber: '10333',
    name: 'The Lord of the Rings: Barad-dûr™',
    legoPriceHuf: 194990,
    productImage: 'https://sh-s7-live-s.legocdn.com/is/image/LEGO/10333_alt1?wid=1024&qlt=90,0&resMode=sharp&op_usm=1,1,0,0',
    legoUrl: 'https://www.lego.com/en-hu/product/the-lord-of-the-rings-barad-dur-10333',
    status: 'planned',
    priority: 'low',
    createdAt: new Date('2024-06-01').toISOString(),
    updatedAt: new Date('2024-06-01').toISOString(),
    hasFetchedLegoInfo: true,
    isTemporary: false,
    releaseDate: null
  },
  {
    id: 'demo-5',
    userId: 'demo-user',
    setNumber: '75456',
    name: 'LEGO® Star Wars™ Advent Calendar',
    legoPriceHuf: 15490,
    productImage: null,
    legoUrl: null,
    status: 'planned',
    priority: 'low',
    createdAt: new Date('2024-07-01').toISOString(),
    updatedAt: new Date('2024-07-01').toISOString(),
    hasFetchedLegoInfo: true,
    isTemporary: true,
    releaseDate: '2024-09-01'
  }
];
