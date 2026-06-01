-- Fix borough names to match the official 33 London boroughs
-- (32 London boroughs + City of London)
-- Merges duplicate/abbreviated entries into the correct official names.

UPDATE parks SET borough = 'Barking and Dagenham'  WHERE borough IN ('Barking', 'Barking & Dagenham');
UPDATE parks SET borough = 'Hammersmith and Fulham' WHERE borough IN ('Hammersmith', 'Hammersmith & Fulham');
UPDATE parks SET borough = 'Kensington and Chelsea' WHERE borough IN ('Kensington', 'Kensington & Chelsea');
UPDATE parks SET borough = 'Kingston upon Thames'   WHERE borough = 'Kingston';
UPDATE parks SET borough = 'Richmond upon Thames'   WHERE borough = 'Richmond';
