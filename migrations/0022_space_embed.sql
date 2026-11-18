-- phase: expand
-- A space other sites may embed (plan §AD.15: "a space as an app: install it on a phone (PWA) or embed it on any
-- site"). Off until its maker turns it on: then its published pages answer with frame-ancestors * (https only) instead
-- of only its own origin and openvibe.space, and the editor shows the snippet to paste.
ALTER TABLE space_apps ADD COLUMN IF NOT EXISTS embeddable boolean NOT NULL DEFAULT false;
