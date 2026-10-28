extends Node2D

var hero := Vector2(430, 370)
var enemies := [Vector2(730, 250), Vector2(820, 470), Vector2(610, 520)]
var enemy_health := [2, 2, 3]
var scrap := [Vector2(280, 260), Vector2(900, 330), Vector2(520, 170)]
var xp := 0
var level := 1
var message := "Explorez les ruines et récupérez des composants."
var attack_flash := 0.0
var font: Font

func _ready() -> void:
	font = ThemeDB.fallback_font
	queue_redraw()

func _process(delta: float) -> void:
	var direction := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	hero += direction * 220.0 * delta
	hero.x = clamp(hero.x, 90.0, 1010.0)
	hero.y = clamp(hero.y, 130.0, 625.0)
	for i in range(enemies.size()):
		var to_hero: Vector2 = hero - enemies[i]
		if to_hero.length() < 240.0:
			enemies[i] += to_hero.normalized() * 24.0 * delta
	attack_flash = max(0.0, attack_flash - delta)
	if Input.is_action_just_pressed("attack"):
		_attack()
	for i in range(scrap.size() - 1, -1, -1):
		if hero.distance_to(scrap[i]) < 28.0:
			scrap.remove_at(i)
			xp += 20
			message = "Composant récupéré. +20 XP"
			if xp >= level * 60:
				level += 1
				xp = 0
				message = "Niveau supérieur ! Votre survivant devient plus efficace."
	queue_redraw()

func _attack() -> void:
	var target := -1
	var closest := 72.0
	for i in range(enemies.size()):
		var distance := hero.distance_to(enemies[i])
		if distance < closest:
			closest = distance
			target = i
	attack_flash = 0.12
	if target == -1:
		message = "Approchez-vous d'un ennemi pour frapper."
		return
	enemy_health[target] -= 1
	if enemy_health[target] <= 0:
		enemies.remove_at(target)
		enemy_health.remove_at(target)
		xp += 30
		message = "Pillard vaincu. +30 XP"
		if xp >= level * 60:
			level += 1
			xp = 0
			message = "Niveau supérieur ! Votre survivant devient plus efficace."
	else:
		message = "Coup porté. Encore %d PV." % enemy_health[target]

func _draw() -> void:
	# Terrain et routes
	draw_rect(Rect2(0, 0, 1100, 700), Color("101923"))
	for x in range(0, 1100, 64):
		for y in range(105, 700, 48):
			var shade := Color("192a2b") if (x / 64 + y / 48 as int) % 2 == 0 else Color("1b2d2d")
			draw_rect(Rect2(x, y, 63, 47), shade)
	draw_rect(Rect2(0, 0, 1100, 92), Color("0b111a"))
	draw_string(font, Vector2(34, 39), "LES CENDRES DE DEMAIN", HORIZONTAL_ALIGNMENT_LEFT, -1, 24, Color("e8d7ad"))
	draw_string(font, Vector2(35, 67), "PROTOTYPE 01  •  SECTEUR DES RUINES", HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color("84959a"))
	draw_string(font, Vector2(790, 38), "NIVEAU %02d" % level, HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color("d4a85f"))
	draw_string(font, Vector2(790, 65), "XP  %02d / %02d" % [xp, level * 60], HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color("b4c7b1"))
	# Ruined structures
	for rect in [Rect2(145, 170, 180, 120), Rect2(820, 145, 150, 115), Rect2(350, 470, 140, 95)]:
		draw_rect(rect, Color("303638"), true)
		draw_rect(rect, Color("69706b"), false, 3)
	# Scrap pickups
	for item in scrap:
		draw_circle(item, 10, Color("d19b48"))
		draw_circle(item, 4, Color("f4d28b"))
	# Enemies
	for enemy in enemies:
		draw_circle(enemy, 17, Color("7c3540"))
		draw_circle(enemy, 9, Color("c25b51"))
		var enemy_index := enemies.find(enemy)
		draw_line(enemy + Vector2(-8, -25), enemy + Vector2(8, -25), Color("43242c"), 5)
		draw_line(enemy + Vector2(-8, -25), enemy + Vector2(-8 + 16 * enemy_health[enemy_index] / 3.0, -25), Color("d46b56"), 5)
	# Hero
	draw_circle(hero + Vector2(0, 8), 18, Color(0, 0, 0, 0.35))
	draw_circle(hero, 16, Color("4f8f8c"))
	draw_circle(hero, 8, Color("b7dfc2"))
	draw_string(font, hero + Vector2(-30, -25), "VOUS", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("d8f1d8"))
	# Hint panel
	draw_rect(Rect2(28, 620, 1044, 52), Color(0.04, 0.06, 0.08, 0.92))
	draw_string(font, Vector2(48, 652), "WASD / FLÈCHES : se déplacer    •    ESPACE : attaquer    •    " + message, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color("d7ded5"))
