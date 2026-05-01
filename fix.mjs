import fs from 'fs';
let code = fs.readFileSync('src/components/SetCard.tsx', 'utf8');
code = code.replace(/Order Date<\/label>/g, 'Purchase Date</label>');
code = code.replace(/Confirm Order/g, 'Confirm Purchase');
fs.writeFileSync('src/components/SetCard.tsx', code);
