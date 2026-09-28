// Recettes de départ de la base « Recettes » (supprime celles qui ne te
// plaisent pas). Pensées pour une personne seule : on cuisine une fois pour
// 2 repas (midi + soir, ou deux midis) ; les plats mijotés font 4 portions et
// se congèlent.
const R = (emoji, title, props, intro, ingredients, steps, tips = []) => ({ emoji, title, props, body:
`# ${title}

${intro}

## Ingrédients
${ingredients.map(i => `- ${i}`).join('\n')}

## Préparation
${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
${tips.length ? `\n## Astuces\n${tips.map(t => `- ${t}`).join('\n')}\n` : ''}` });

module.exports = [
    R('🍛', 'Curry de lentilles corail', { categorie: 'Plat', preparation: 10, cuisson: 20, portions: 2, difficulte: 'Facile', regime: ['Végétarien', 'Vegan'], tags: ['Batch cooking', 'Économique', 'Réconfortant'] },
        'Un curry doux et crémeux, prêt en 30 minutes, encore meilleur réchauffé le lendemain.',
        ['150 g de lentilles corail', '1 oignon', '2 gousses d’ail', '1 c. à café de gingembre en poudre', '1 c. à soupe de curry', '200 ml de lait de coco', '1 boîte (400 g) de tomates concassées', '1 poignée d’épinards', '120 g de riz basmati', '1 c. à soupe d’huile d’olive', 'sel, poivre'],
        ['Émincer l’oignon et l’ail, les faire revenir 3 min dans l’huile.', 'Ajouter le curry et le gingembre, remuer 1 min pour réveiller les épices.', 'Verser les lentilles rincées, les tomates et le lait de coco. Laisser mijoter 18 min à feu doux en remuant.', 'Pendant ce temps, cuire le riz.', 'Ajouter les épinards 2 min avant la fin, saler, poivrer.'],
        ['Se garde 3 jours au frigo dans une boîte hermétique.', 'Un filet de citron vert au service relève tout.']),

    R('🌶️', 'Chili con carne', { categorie: 'Plat', preparation: 15, cuisson: 45, portions: 4, difficulte: 'Facile', regime: ['Riche en protéines', 'Sans gluten'], tags: ['Batch cooking', 'Réconfortant', 'Hiver'] },
        'Le plat mijoté parfait à préparer le dimanche : 4 portions dont 2 à congeler.',
        ['400 g de bœuf haché', '1 oignon', '1 poivron rouge', '2 gousses d’ail', '1 boîte (400 g) de haricots rouges', '1 boîte (400 g) de tomates concassées', '1 c. à soupe de concentré de tomates', '1 c. à café de cumin', '1 c. à café de paprika', '1 pincée de piment', '200 g de riz', '1 c. à soupe d’huile d’olive', 'sel, poivre'],
        ['Faire revenir l’oignon, l’ail et le poivron coupés dans l’huile 5 min.', 'Ajouter la viande, la faire dorer en l’émiettant.', 'Ajouter les épices et le concentré, remuer 1 min.', 'Verser les tomates et les haricots égouttés. Mijoter 35 min à couvert.', 'Servir avec le riz.'],
        ['Se congèle très bien jusqu’à 3 mois.', 'Un carré de chocolat noir dans la sauce : le secret des chilis mexicains.']),

    R('🍗', 'Poulet au citron et légumes rôtis', { categorie: 'Plat', preparation: 15, cuisson: 40, portions: 2, difficulte: 'Facile', regime: ['Sans gluten', 'Riche en protéines'], tags: ['Plaque au four', 'Léger'] },
        'Tout cuit sur une seule plaque : peu de vaisselle, beaucoup de saveur.',
        ['2 cuisses de poulet', '400 g de pommes de terre grenaille', '2 carottes', '1 courgette', '1 citron', '3 gousses d’ail', '2 brins de romarin', '2 c. à soupe d’huile d’olive', 'sel, poivre'],
        ['Préchauffer le four à 200 °C.', 'Couper les légumes en morceaux, les étaler sur la plaque avec l’ail en chemise.', 'Poser le poulet, arroser d’huile et du jus du citron, ajouter le romarin et les rondelles de citron.', 'Enfourner 40 min en retournant les légumes à mi-cuisson.'],
        ['La deuxième cuisse se mange froide le lendemain en salade.']),

    R('🍝', 'Pâtes carbonara', { categorie: 'Plat', preparation: 5, cuisson: 12, portions: 2, difficulte: 'Facile', regime: [], tags: ['Rapide', 'Réconfortant'] },
        'La vraie : pas de crème, juste des œufs, du fromage et de la patience.',
        ['200 g de spaghetti', '120 g de lardons', '2 œufs', '1 jaune d’œuf', '50 g de parmesan', 'poivre'],
        ['Cuire les pâtes dans une grande casserole d’eau salée.', 'Faire dorer les lardons à sec.', 'Battre les œufs, le jaune et le parmesan râpé avec beaucoup de poivre.', 'Hors du feu, mélanger les pâtes égouttées aux lardons, puis ajouter les œufs et une louche d’eau de cuisson en remuant vite pour obtenir une sauce crémeuse.'],
        ['Hors du feu, sinon les œufs cuisent en omelette.']),

    R('🍄', 'Risotto aux champignons', { categorie: 'Plat', preparation: 10, cuisson: 25, portions: 2, difficulte: 'Moyen', regime: ['Végétarien', 'Sans gluten'], tags: ['Réconfortant', 'Automne'] },
        'Crémeux sans crème grâce à l’amidon du riz et à un peu de patience.',
        ['160 g de riz arborio', '250 g de champignons de Paris', '1 échalote', '1 gousse d’ail', '10 cl de vin blanc', '700 ml de bouillon de légumes', '40 g de parmesan', '20 g de beurre', '1 c. à soupe d’huile d’olive', 'persil'],
        ['Faire chauffer le bouillon. Émincer échalote, ail et champignons.', 'Faire dorer les champignons dans l’huile, réserver.', 'Faire suer l’échalote, ajouter le riz et le nacrer 2 min.', 'Déglacer au vin blanc, puis ajouter le bouillon louche par louche en remuant, pendant 18 min.', 'Hors du feu : champignons, beurre, parmesan, persil. Couvrir 2 min avant de servir.']),

    R('🥣', 'Soupe de légumes d’hiver', { categorie: 'Soupe', preparation: 15, cuisson: 30, portions: 4, difficulte: 'Facile', regime: ['Végétarien', 'Vegan', 'Sans gluten'], tags: ['Batch cooking', 'Léger', 'Hiver', 'Économique'] },
        'Une grande marmite pour 4 bols : 2 pour la semaine, 2 au congélateur.',
        ['3 carottes', '2 poireaux', '2 pommes de terre', '1 navet', '1 oignon', '1,2 l de bouillon de légumes', '1 c. à soupe d’huile d’olive', 'sel, poivre'],
        ['Éplucher et couper tous les légumes en morceaux.', 'Faire revenir l’oignon et les poireaux dans l’huile 5 min.', 'Ajouter le reste des légumes et le bouillon, cuire 25 min.', 'Mixer, rectifier l’assaisonnement.'],
        ['Une cuillère de crème ou de fromage frais au service pour les jours de fête.']),

    R('🎃', 'Velouté de potiron et lait de coco', { categorie: 'Soupe', preparation: 10, cuisson: 25, portions: 2, difficulte: 'Facile', regime: ['Végétarien', 'Vegan', 'Sans gluten'], tags: ['Automne', 'Léger'] },
        'Doux, épicé juste ce qu’il faut, prêt en 35 minutes.',
        ['600 g de potiron', '1 oignon', '1 c. à café de curry', '200 ml de lait de coco', '400 ml de bouillon de légumes', '1 c. à soupe de graines de courge', 'sel, poivre'],
        ['Couper le potiron en cubes, émincer l’oignon.', 'Faire revenir l’oignon avec le curry, ajouter le potiron et le bouillon, cuire 20 min.', 'Ajouter le lait de coco, mixer finement.', 'Servir parsemé de graines de courge grillées.']),

    R('🥗', 'Salade César au poulet', { categorie: 'Salade', preparation: 15, cuisson: 10, portions: 2, difficulte: 'Facile', regime: ['Riche en protéines'], tags: ['Rapide', 'Été'] },
        'La salade-repas qui tient au corps, avec une sauce maison express.',
        ['2 blancs de poulet', '1 salade romaine', '2 tranches de pain', '40 g de parmesan', '2 c. à soupe de mayonnaise', '1 c. à café de moutarde', '1 gousse d’ail', '½ citron', '1 c. à soupe d’huile d’olive'],
        ['Cuire le poulet à la poêle 5 min de chaque côté, le trancher.', 'Faire dorer le pain en cubes dans l’huile pour les croûtons.', 'Mélanger mayonnaise, moutarde, ail râpé, jus de citron et un peu de parmesan.', 'Assembler salade, poulet, croûtons, copeaux de parmesan et sauce.'],
        ['Pour le lendemain, garder la sauce à part pour que la salade reste croquante.']),

    R('🥙', 'Buddha bowl quinoa et patate douce', { categorie: 'Plat', preparation: 15, cuisson: 25, portions: 2, difficulte: 'Facile', regime: ['Végétarien', 'Vegan', 'Sans gluten'], tags: ['Léger', 'Coloré'] },
        'Un bol complet et coloré, qui se prépare à l’avance et se mange froid ou tiède.',
        ['120 g de quinoa', '1 patate douce', '1 boîte (400 g) de pois chiches', '1 avocat', '1 poignée de roquette', '1 c. à café de paprika', '2 c. à soupe de tahini', '1 citron', '2 c. à soupe d’huile d’olive', 'sel'],
        ['Four à 200 °C. Couper la patate douce en cubes, la rôtir 25 min avec les pois chiches, l’huile et le paprika.', 'Cuire le quinoa 12 min.', 'Mélanger tahini, jus de citron et un peu d’eau pour la sauce.', 'Composer les bols : quinoa, roquette, légumes rôtis, avocat, sauce.']),

    R('🐟', 'Saumon laqué soja-miel, riz et brocolis', { categorie: 'Plat', preparation: 10, cuisson: 15, portions: 2, difficulte: 'Facile', regime: ['Riche en protéines'], tags: ['Rapide'] },
        'Sucré-salé, brillant, prêt en 25 minutes.',
        ['2 pavés de saumon', '140 g de riz', '1 brocoli', '3 c. à soupe de sauce soja', '1 c. à soupe de miel', '1 gousse d’ail', '1 c. à café de graines de sésame'],
        ['Cuire le riz. Détailler le brocoli en fleurettes et le cuire 6 min à la vapeur.', 'Mélanger soja, miel et ail râpé.', 'Saisir le saumon côté peau 4 min, le retourner, verser la sauce et laquer 2 min.', 'Servir avec le riz, le brocoli et le sésame.']),

    R('🍳', 'Omelette aux champignons et fromage', { categorie: 'Plat', preparation: 5, cuisson: 8, portions: 1, difficulte: 'Facile', regime: ['Végétarien', 'Sans gluten'], tags: ['Rapide', 'Économique'] },
        'Le dîner de dernière minute, pour une personne.',
        ['3 œufs', '100 g de champignons de Paris', '30 g d’emmental', '1 noix de beurre', 'ciboulette', 'sel, poivre'],
        ['Émincer et faire dorer les champignons dans le beurre.', 'Battre les œufs, saler, poivrer.', 'Verser sur les champignons, cuire à feu moyen en ramenant les bords vers le centre.', 'Ajouter le fromage et la ciboulette, plier et servir.']),

    R('🥧', 'Quiche lorraine', { categorie: 'Plat', preparation: 15, cuisson: 35, portions: 4, difficulte: 'Facile', regime: [], tags: ['Batch cooking', 'Réconfortant'] },
        'Une quiche = 4 parts : 2 repas avec une salade, et 2 parts pour la semaine.',
        ['1 rouleau de pâte brisée', '200 g de lardons', '3 œufs', '20 cl de crème fraîche', '20 cl de lait', '80 g d’emmental', 'muscade', 'poivre'],
        ['Four à 180 °C. Foncer un moule avec la pâte, piquer le fond.', 'Faire dorer les lardons à sec, les répartir sur la pâte.', 'Battre œufs, crème, lait, muscade, poivre ; verser.', 'Parsemer d’emmental et cuire 35 min.'],
        ['Se garde 3 jours au frigo, se réchauffe au four (pas au micro-ondes : la pâte ramollit).']),

    R('🥔', 'Gratin dauphinois', { categorie: 'Accompagnement', preparation: 20, cuisson: 60, portions: 4, difficulte: 'Facile', regime: ['Végétarien', 'Sans gluten'], tags: ['Réconfortant', 'Hiver'] },
        'Le vrai, fondant, avec juste de la crème, du lait et de l’ail.',
        ['1 kg de pommes de terre', '30 cl de crème fraîche', '30 cl de lait', '2 gousses d’ail', '1 noix de beurre', 'muscade', 'sel, poivre'],
        ['Four à 160 °C. Frotter un plat avec l’ail et le beurre.', 'Trancher finement les pommes de terre, sans les rincer.', 'Les chauffer 10 min dans le lait, la crème, l’ail, la muscade, le sel et le poivre.', 'Verser dans le plat, cuire 1 h jusqu’à ce que le dessus soit doré.']),

    R('🍷', 'Bœuf bourguignon', { categorie: 'Plat', preparation: 25, cuisson: 150, portions: 4, difficulte: 'Moyen', regime: ['Riche en protéines'], tags: ['Batch cooking', 'Hiver', 'Réconfortant'] },
        'Le grand classique du dimanche. Meilleur réchauffé, parfait à congeler.',
        ['800 g de bœuf à braiser', '150 g de lardons', '250 g de champignons de Paris', '3 carottes', '2 oignons', '2 gousses d’ail', '75 cl de vin rouge', '2 c. à soupe de farine', '1 bouquet garni', '2 c. à soupe d’huile', 'sel, poivre'],
        ['Faire dorer la viande en morceaux dans l’huile, par petites quantités. Réserver.', 'Faire revenir lardons, oignons et carottes. Remettre la viande, saupoudrer de farine.', 'Mouiller avec le vin, ajouter ail et bouquet garni. Mijoter 2 h 30 à couvert et à feu doux.', 'Ajouter les champignons dorés 20 min avant la fin.'],
        ['Servir avec des pâtes fraîches ou des pommes de terre vapeur.']),

    R('🫒', 'Tajine de poulet aux olives et citron confit', { categorie: 'Plat', preparation: 15, cuisson: 50, portions: 2, difficulte: 'Moyen', regime: ['Sans gluten', 'Riche en protéines'], tags: ['Voyage'] },
        'Les parfums du Maroc, sans tajine : une cocotte suffit.',
        ['2 cuisses de poulet', '1 oignon', '2 gousses d’ail', '1 citron confit', '60 g d’olives vertes', '1 c. à café de curcuma', '1 c. à café de gingembre en poudre', '1 pincée de safran', '1 bouquet de coriandre', '120 g de semoule', '1 c. à soupe d’huile d’olive'],
        ['Faire dorer le poulet dans l’huile, ajouter oignon et ail émincés.', 'Ajouter épices, citron confit en lanières et 20 cl d’eau. Couvrir et mijoter 40 min.', 'Ajouter les olives 10 min avant la fin.', 'Servir avec la semoule et la coriandre ciselée.']),

    R('🍜', 'Pad thaï aux crevettes', { categorie: 'Plat', preparation: 15, cuisson: 10, portions: 2, difficulte: 'Moyen', regime: ['Sans gluten'], tags: ['Rapide', 'Voyage'] },
        'Le plat de rue thaïlandais, au wok, en 25 minutes.',
        ['150 g de nouilles de riz', '200 g de crevettes décortiquées', '2 œufs', '100 g de pousses de soja', '2 oignons nouveaux', '2 c. à soupe de sauce soja', '1 c. à soupe de sucre', '1 citron vert', '30 g de cacahuètes', '1 c. à soupe d’huile'],
        ['Réhydrater les nouilles dans l’eau chaude 8 min, égoutter.', 'Saisir les crevettes dans l’huile, pousser sur le côté et brouiller les œufs.', 'Ajouter nouilles, sauce soja, sucre et jus de citron vert, mélanger 2 min.', 'Hors du feu : pousses de soja, oignons nouveaux, cacahuètes concassées.']),

    R('🥢', 'Wok de légumes et tofu', { categorie: 'Plat', preparation: 15, cuisson: 10, portions: 2, difficulte: 'Facile', regime: ['Végétarien', 'Vegan'], tags: ['Rapide', 'Léger'] },
        'Croquant, rapide, et un excellent moyen de finir les légumes du frigo.',
        ['200 g de tofu ferme', '1 poivron', '1 carotte', '1 courgette', '100 g de pois gourmands', '2 c. à soupe de sauce soja', '1 c. à café de gingembre en poudre', '1 gousse d’ail', '150 g de nouilles', '1 c. à soupe d’huile de sésame'],
        ['Couper le tofu en cubes et le faire dorer dans l’huile. Réserver.', 'Sauter les légumes en lamelles 5 min à feu vif avec l’ail et le gingembre.', 'Ajouter les nouilles cuites, le tofu et la sauce soja, mélanger 2 min.']),

    R('🥘', 'Hachis parmentier', { categorie: 'Plat', preparation: 25, cuisson: 25, portions: 4, difficulte: 'Facile', regime: [], tags: ['Batch cooking', 'Réconfortant', 'Économique'] },
        'Un plat pour 4 : deux repas maintenant, deux parts au congélateur.',
        ['1 kg de pommes de terre', '400 g de bœuf haché', '1 oignon', '1 gousse d’ail', '20 cl de lait', '40 g de beurre', '60 g d’emmental', 'muscade', 'sel, poivre'],
        ['Cuire les pommes de terre 20 min, les écraser avec le lait, le beurre et la muscade.', 'Faire revenir oignon et ail, ajouter la viande et la cuire 8 min.', 'Dans un plat : la viande, puis la purée, puis le fromage.', 'Gratiner 25 min à 200 °C.']),

    R('🍆', 'Ratatouille', { categorie: 'Accompagnement', preparation: 20, cuisson: 45, portions: 4, difficulte: 'Facile', regime: ['Végétarien', 'Vegan', 'Sans gluten'], tags: ['Été', 'Batch cooking', 'Léger'] },
        'Chaque légume cuit à part pour garder son goût, puis tout mijote ensemble.',
        ['1 aubergine', '2 courgettes', '1 poivron rouge', '1 poivron jaune', '4 tomates', '1 oignon', '3 gousses d’ail', '3 c. à soupe d’huile d’olive', '1 c. à café d’herbes de Provence', 'sel, poivre'],
        ['Couper tous les légumes en dés.', 'Faire revenir séparément aubergine, courgettes et poivrons dans l’huile.', 'Faire fondre oignon et ail, ajouter les tomates, puis tous les légumes et les herbes.', 'Mijoter 30 min à couvert.'],
        ['Délicieuse chaude, tiède ou froide ; avec un œuf au plat, c’est un repas.']),

    R('🍅', 'Shakshuka', { categorie: 'Plat', preparation: 10, cuisson: 20, portions: 2, difficulte: 'Facile', regime: ['Végétarien', 'Sans gluten'], tags: ['Rapide', 'Économique'] },
        'Des œufs pochés dans une sauce tomate épicée, à saucer avec du bon pain.',
        ['4 œufs', '1 boîte (400 g) de tomates concassées', '1 poivron rouge', '1 oignon', '2 gousses d’ail', '1 c. à café de cumin', '1 c. à café de paprika', '50 g de feta', 'coriandre', '1 c. à soupe d’huile d’olive', '1 baguette'],
        ['Faire revenir oignon, poivron et ail dans l’huile 8 min.', 'Ajouter les épices puis les tomates, mijoter 10 min.', 'Creuser 4 puits, y casser les œufs, couvrir et cuire 6 min.', 'Parsemer de feta et de coriandre, servir avec le pain.']),

    R('🥣', 'Overnight oats', { categorie: 'Petit-déjeuner', preparation: 5, cuisson: 0, portions: 2, difficulte: 'Facile', regime: ['Végétarien'], tags: ['Rapide', 'À l’avance'] },
        'Préparé le soir, prêt le matin : deux petits-déjeuners d’un coup.',
        ['100 g de flocons d’avoine', '250 ml de lait', '2 yaourts nature', '2 c. à soupe de graines de chia', '2 c. à café de miel', '1 banane', '1 poignée de fruits rouges'],
        ['Mélanger flocons, lait, yaourt, chia et miel dans deux bocaux.', 'Fermer et laisser une nuit au frigo.', 'Le matin, ajouter la banane en rondelles et les fruits rouges.']),

    R('🥞', 'Pancakes moelleux', { categorie: 'Petit-déjeuner', preparation: 10, cuisson: 15, portions: 2, difficulte: 'Facile', regime: ['Végétarien'], tags: ['Week-end'] },
        'Pour le brunch du dimanche, épais et moelleux.',
        ['150 g de farine', '1 œuf', '20 cl de lait', '1 c. à soupe de sucre', '1 sachet de levure', '20 g de beurre', 'sirop d’érable'],
        ['Mélanger farine, sucre et levure.', 'Ajouter l’œuf, le lait et le beurre fondu, fouetter sans trop travailler.', 'Cuire des petites louches dans une poêle chaude, 2 min par face.', 'Servir avec le sirop d’érable.']),

    R('🍎', 'Tarte fine aux pommes', { categorie: 'Dessert', preparation: 15, cuisson: 25, portions: 4, difficulte: 'Facile', regime: ['Végétarien'], tags: ['Économique'] },
        'Croustillante et toute simple : une pâte, des pommes, du beurre.',
        ['1 rouleau de pâte feuilletée', '3 pommes', '30 g de beurre', '2 c. à soupe de sucre', '1 c. à café de cannelle'],
        ['Four à 200 °C. Étaler la pâte sur une plaque.', 'Disposer les pommes en fines lamelles.', 'Parsemer de beurre en noisettes, de sucre et de cannelle.', 'Cuire 25 min jusqu’à ce que les bords soient dorés.']),

    R('🍫', 'Mousse au chocolat', { categorie: 'Dessert', preparation: 15, cuisson: 0, portions: 4, difficulte: 'Facile', regime: ['Végétarien', 'Sans gluten'], tags: ['À l’avance'] },
        'Deux ingrédients, légère et intense. À préparer la veille.',
        ['150 g de chocolat noir', '4 œufs', '1 pincée de sel'],
        ['Faire fondre le chocolat au bain-marie, laisser tiédir.', 'Séparer les blancs des jaunes. Incorporer les jaunes au chocolat.', 'Monter les blancs en neige ferme avec le sel.', 'Incorporer délicatement les blancs au chocolat, répartir en ramequins, 4 h au frigo.']),

    R('🌿', 'Taboulé libanais', { categorie: 'Salade', preparation: 20, cuisson: 0, portions: 2, difficulte: 'Facile', regime: ['Végétarien', 'Vegan'], tags: ['Été', 'Léger'] },
        'Le vrai taboulé : beaucoup de persil, un peu de boulgour.',
        ['50 g de boulgour fin', '2 bouquets de persil plat', '1 bouquet de menthe', '3 tomates', '2 oignons nouveaux', '2 citrons', '4 c. à soupe d’huile d’olive', 'sel'],
        ['Faire gonfler le boulgour 15 min dans le jus des citrons.', 'Ciseler très finement persil et menthe.', 'Couper les tomates et les oignons en petits dés.', 'Tout mélanger avec l’huile et le sel, laisser reposer 30 min au frais.']),

    R('🥪', 'Croque-monsieur au four', { categorie: 'Plat', preparation: 10, cuisson: 12, portions: 2, difficulte: 'Facile', regime: [], tags: ['Rapide', 'Réconfortant'] },
        'Version gratinée à la béchamel express, avec une salade verte.',
        ['4 tranches de pain de mie', '2 tranches de jambon', '80 g d’emmental', '20 cl de lait', '1 c. à soupe de farine', '15 g de beurre', 'muscade', '1 salade verte'],
        ['Béchamel : faire fondre le beurre, ajouter la farine, puis le lait en fouettant jusqu’à épaississement ; muscade.', 'Garnir le pain de béchamel, jambon et fromage, refermer.', 'Napper le dessus de béchamel et de fromage.', 'Cuire 12 min à 200 °C, servir avec la salade.'])
];
