# MOMO Shogi-style Quantum Shogi (hereinafter referred to as "Quantum Shogi") Rulebook

Version 1.0

---

# Introduction

Quantum Shogi is a strategy board game based on traditional shogi.

The biggest difference from traditional shogi is that **the identity of each piece is not known at the beginning of the game.**

As the game progresses, the true identity of each piece gradually becomes known.

Players must deduce not only the identities of their opponent's pieces but also those of their own.

---

# What is Quantum Shogi?

In Quantum Shogi, every piece has a **candidate set**.

For example, a piece may have the following candidates:

* King
* Gold
* Silver

At this point, the piece has not yet been determined to be any one of these.

As the game progresses, candidates are eliminated until only one remains.

When only one candidate remains, the piece becomes confirmed as that piece.

---

# Game Features

Quantum Shogi has the following characteristics.

* All information is public.
* There is no randomness.
* Candidates never increase; they only decrease.
* Piece identities are determined through logical deduction.
* Traditional shogi strategy is still required.

---

# Objective

Checkmate your opponent's **confirmed King** to win.

Capturing the confirmed King also wins. This can happen, for example, when the King is already in a position to be captured at the moment it becomes confirmed.

Capturing a piece that is only a King candidate does not win the game.

The game ends immediately when the confirmed King is captured.

---

# Game Setup

At the start of the game:

* Arrange the pieces in their initial positions.
* Every piece begins with its assigned candidate set. At the start of the game, every piece has all of King, Rook, Bishop, Gold General, Silver General, Knight, Lance, and Pawn as candidates.
* Black (First Player) moves first.

---

# The Pieces

The game uses the same types and numbers of pieces as traditional shogi.

* King
* Rook
* Bishop
* Gold General
* Silver General
* Knight
* Lance
* Pawn

However, at the beginning of the game, the actual identity of each piece has not yet been confirmed.

---

# Candidate Sets

A candidate represents a possible identity of a piece.

For example,

```
Pawn / Silver / Gold
```

means the piece could be:

* a Pawn,
* a Silver,
* or a Gold.

Its true identity has not yet been determined.

---

# Eliminating Candidates

During the game, candidates are eliminated through actions such as:

* moving a piece,
* capturing a piece,
* confirming other pieces.

Example:

```
Pawn / Silver / Gold

↓

Cannot be Silver

↓

Pawn / Gold

↓

Cannot be Pawn

↓

Gold
```

When only one candidate remains, the piece is confirmed.

---

# Moving Pieces

A piece may move according to the legal movement of its current candidates.

As candidates are eliminated, the available movements may change.

---

# Turns

Players alternate turns.

On each turn, a player may:

* move one piece, or
* drop one captured piece.

---

# Capturing

A piece is captured by moving onto a square occupied by an opponent's piece.

Captured pieces become the property of the capturing player.

---

# Pieces in Hand

Captured pieces become pieces in hand.

A player may drop a piece in hand onto the board during their turn.

The same placement restrictions as traditional shogi apply.

A piece with multiple candidates may be dropped on a square if at least one of its candidates could be dropped there. After the drop, any candidates that cannot exist on that square are removed.

---

# Promotion

The promotable pieces are the same as in traditional shogi.

When promotion is available, the player may choose to:

* Promote
* Not Promote

Some moves require mandatory promotion.

When a piece with multiple candidates promotes, the candidates that cannot promote (King and Gold General) are removed. When it does not promote, the candidates that could not remain on that square without promoting are removed.

---

# The King

Each player has exactly one King.

However, at the beginning of the game, it is unknown which piece is the King.

When a piece's candidate set is reduced to only "King," it becomes the confirmed King.

---

# Check

A confirmed King is in check if it can be legally captured on the opponent's next move.

King candidates that have not yet been confirmed cannot be in check.

---

# Checkmate

Checkmate occurs when there is no legal move that removes the check.

The game ends immediately when checkmate occurs.

---

# Winning the Game

You win by checkmating your opponent's confirmed King.

Capturing the confirmed King also wins. This can happen, for example, when the King is already in a position to be captured at the moment it becomes confirmed.

Capturing a King candidate does not end the game.

---

# Double Pawn

A player may not have two unpromoted Pawns on the same file.

---

# Pawn Drop Mate

A Pawn may not be dropped if the drop immediately produces checkmate.

This also applies to dropping a piece that becomes confirmed as a Pawn as a result of the drop. If a piece with multiple candidates is dropped and produces checkmate, that piece is treated as not being a Pawn, and its Pawn candidate is removed.

---

# Repetition

A repetition occurs when the same position appears four times.

A position includes:

* piece locations,
* candidate sets,
* promotion states,
* pieces in hand,
* and the player to move.

---

# Nyugyoku Declaration and Jishogi

Nyugyoku (entering King) declaration and Jishogi (impasse) work the same as in traditional shogi. However, because piece identities may not yet be confirmed, they are interpreted as follows.

* A player is considered to have entered the enemy camp only when every piece that still has King as a candidate is inside the enemy camp and none of them is within reach of an opponent's piece.
* For points, a piece counts as 5 points only if all of its candidates are major pieces (Rook, Bishop, Dragon, Horse); every other piece counts as 1 point. Then 1 point is subtracted for the King.

---

# Game Flow

The game proceeds in the following order.

```
Game Start

↓

Start Turn

↓

Choose a Legal Move

↓

Make the Move

↓

(Is the confirmed King captured?)

Yes
↓

Game Ends

No
↓

Capture Processing

↓

Promotion Decision

↓

Candidate Update

↓

Candidate Confirmation and Propagation

↓

Victory Check

↓

If the game has not ended,
change turns.
```

---

# How Candidate Propagation Works

In Quantum Shogi, when the identity of one piece becomes confirmed, the candidate sets of other pieces belonging to the same original side may also be updated in succession.

This is possible because the number of each type of piece is fixed, just as in traditional shogi.

For example, each player has exactly **two Gold Generals**.

Once both Gold Generals have been identified, no other piece belonging to the same original player can possibly be a Gold General.

This process, where new information automatically affects other pieces, is described as **candidates propagating**, and in this game, the propagation of candidates is called **Quantum Entanglement**.

---

## Example 1: Propagation Within the Same Side

Suppose one player's pieces have the following candidate sets:

```
Piece A   Gold / Silver
Piece B   Gold / Knight
Piece C   Gold / Pawn
Piece D   Gold (Confirmed)
```

Piece D has already been confirmed as a Gold General.

Since there are only **two Gold Generals** for that player, only **one** of Pieces A, B, and C can still be a Gold General.

Later in the game, Piece A becomes confirmed as a Gold General.

```
Piece A = Gold
```

Now both Gold Generals belonging to that player have been identified:

* Piece A
* Piece D

Therefore, Pieces B and C can no longer be Gold Generals.

Their candidate sets become:

```
Piece B   Knight
Piece C   Pawn
```

As a result, both pieces become confirmed.

This illustrates how confirming a single piece can immediately determine the identities of several others.

---

## Example 2: Propagation to an Opponent's Piece

Candidates propagate not only to pieces currently under your control.

It also applies to your original pieces that have been captured by your opponent.

Suppose the position is as follows:

```
Your original pieces

Piece A   Gold / Silver
Piece D   Gold (Confirmed)

One of your original pieces,
currently controlled by your opponent

Piece C   Gold / Pawn
```

At this point, either Piece A or Piece C could still be the second Gold General.

Later, Piece A becomes confirmed as a Gold General.

```
Piece A = Gold
```

Now your two Gold Generals are known to be:

* Piece A
* Piece D

Therefore, Piece C cannot be a Gold General.

Its candidate set becomes:

```
Piece C = Pawn
```

Even though Piece C is currently controlled by your opponent, its candidate set is still updated.

---

## Captured Pieces Still Keep Their Original Identity Group

In Quantum Shogi, capturing a piece changes its owner, but **it does not change which player originally owned that piece.**

Candidate propagation is always based on a piece's **original owner**, not its current owner.

As a result, candidates propagate to all of the following:

* Your pieces on the board
* Your pieces in hand
* Your original pieces currently on your opponent's side of the board
* Your original pieces currently held in your opponent's hand

Because every piece permanently belongs to its original identity group, information discovered anywhere in the game can propagate across the entire position.

This allows a single confirmation to trigger a chain of confirmations, even involving pieces currently controlled by the opposing player.

# How the Double Pawn Rule Affects Candidate Sets

In Quantum Shogi, the Double Pawn rule is the same as in traditional shogi.

A player may not have two unpromoted Pawns on the same file.

In addition, each player begins the game with exactly **nine Pawns**.

Therefore, in the initial position, **every file must contain exactly one Pawn belonging to that player's original set of pieces.**

This rule also affects candidate sets during the game.

For example, suppose the two pieces originally placed on the first file have the following candidate sets:

```
First File

Piece A   Pawn / Silver
Piece B   Pawn / Knight
```

Later in the game, Piece A is confirmed as a Silver.

```
Piece A = Silver
```

Since every file must contain one Pawn, Piece B must be the Pawn.

```
Piece B = Pawn
```

Conversely, if Piece A is confirmed as the Pawn,

```
Piece A = Pawn
```

then Piece B cannot be a Pawn.

```
Piece B = Knight
```

Thus, the Double Pawn rule does more than simply prohibit illegal positions.

The requirement that every file must contain exactly one Pawn in the initial setup also provides valuable information for determining candidate sets.

---

# Dropping a Piece Under the Double Pawn Rule

The Double Pawn rule also applies when dropping a captured piece.

Suppose the fifth file already contains a confirmed Pawn.

```
Fifth File

Board Piece   Pawn (Confirmed)
```

Now suppose you drop a captured piece whose candidate set is:

```
Pawn / Silver
```

onto the fifth file.

If that piece were a Pawn, the result would be a Double Pawn, which is illegal.

Therefore, the Pawn candidate is eliminated.

```
Pawn / Silver

↓

Silver
```

The dropped piece is immediately confirmed as a Silver.

In this way, the location where a piece is dropped can also change its candidate set.

---

# How King Candidates Are Eliminated

Each player has exactly one King.

When a **confirmed King** is captured, the game ends at that moment.

Therefore, capturing a piece that merely includes King as one of its candidates does **not** end the game.

For example, suppose you capture an opponent's piece with the following candidate set:

```
King / Gold / Silver
```

The game continues after the capture.

Since the game did not end, the captured piece could not have been the King.

Therefore, the King candidate is removed.

```
King / Gold / Silver

↓

Gold / Silver
```

In Quantum Shogi, the simple fact that **the game continues** provides new information and can eliminate candidates.

---

# A Strategy: Taking Away Your Opponent's Rook

In Quantum Shogi, a captured piece always keeps the candidate set of the player who originally owned it.

As a result, confirming the identity of a captured piece can also affect your opponent's remaining pieces.

For example, suppose you capture one of your opponent's pieces that still has Rook as one of its candidates.

Later, you drop that captured piece onto the board under your control.

If you then make a move that only a Rook can legally perform—for example, moving two or more squares horizontally—that piece is immediately confirmed as a Rook.

Once this happens, your opponent's original Rooks are fully identified.

Therefore, every remaining piece that originally belonged to your opponent immediately loses its Rook candidate.

In effect, you have not only captured one of your opponent's pieces, but also removed the possibility that any other original piece could still be the Rook.

To prevent this situation, your opponent may choose to confirm one of their own original pieces as a Rook before you do.

Doing so ensures that the captured piece can no longer become their second original Rook.

For this reason, players must consider not only how to confirm their own pieces, but also how the pieces they have captured may influence their opponent's remaining candidate sets.

# Frequently Asked Questions

## How is this different from traditional shogi?

The identities of the pieces are not known at the beginning of the game.

---

## Can candidates increase?

No.

Candidates can only decrease.

---

## Is there hidden information?

No.

All information is visible to both players.

---

## Is there any randomness?

No.

Every result is determined entirely by the game rules and the current position.

---

## Does capturing a King candidate win the game?

No.

Only the confirmed King counts toward winning.

---

# Glossary

|Term|Meaning|
|-|-|
|Candidate|A possible identity of a piece|
|Candidate Set|All possible identities of a piece|
|Confirmed|Only one candidate remains|
|Quantum Entanglement|Candidates of other pieces being propagated and updated, for example when one piece becomes confirmed|
|King Candidate|A piece whose candidate set includes King|
|King|A piece confirmed as the King|
|Legal Move|A move allowed by the rules|
|Capture|Taking an opponent's piece|
|Piece in Hand|A captured piece owned by a player|
|Promotion|Changing a piece into its promoted form|
|Check|A confirmed King can be captured next move|
|Checkmate|No legal move can remove the check|
|Double Pawn|Two unpromoted Pawns on the same file|
|Pawn Drop Mate|Dropping a Pawn that immediately causes checkmate|
|Repetition|The same position appears four times|



