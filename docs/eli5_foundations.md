# ELI5 Foundations — the math, physics, and parts you actually need

A companion to [`eli5.md`](eli5.md). The first one taught you the
*what*; this one teaches you the *underneath*.

Goal: enough math, deep-learning theory, physics, and hardware
vocabulary that you can read a robotics paper or sit in a room with
the people building this stuff and not be lost. Not enough to
actually implement any of it from scratch — that's a different book.

I assume you're rusty on math. I'll spend the first part bringing
you back. After that I'll layer math on top of plain-English
explanations only when it adds something.

Read top to bottom or jump around:

- [Part 0: The training loop in plain English (no math)](#part-0-the-training-loop-in-plain-english)
- [Part 1: Math refresh (for the decades-rusty)](#part-1-math-refresh)
- [Part 2: How a neural net actually works](#part-2-how-a-neural-net-actually-works)
- [Part 3: The model families you'll hear about](#part-3-the-model-families)
- [Part 4: The physics that the sim is solving](#part-4-the-physics-the-sim-is-solving)
- [Part 5: Actuators — what makes robots move](#part-5-actuators)
- [Part 6: Sensors — what robots see and feel](#part-6-sensors)
- [Part 7: A full humanoid, end-to-end](#part-7-a-full-humanoid-end-to-end)

---

# Part 0: The training loop in plain English

I dropped this into the conversation earlier; pinning it here.

**A brain is a pile of dials.** Tens of millions of small numerical
dials. The "policy network" is just *what the brain does given the
current settings of all its dials*.

**Training is turning the dials.** Each round of training, every
dial gets turned by a tiny amount. After enough rounds the dials
are at settings that make the brain good at the task. That's the
whole thing.

**One round** ("gradient step") = one tiny adjustment of every dial,
all at once. Training is a million tiny adjustments.

## The training loop

```
1. Send the brain into the gym. Let it play for a while.
   (Run 4,096 envs for 32 ticks each — collect the rollout data.)

2. Look at the tape. For every action the brain took, ask:
      "Did things go better or worse than expected after this?"
   That's the per-action score. Better = good action. Worse = bad action.

3. Adjust the dials.
   - Actions that scored well → turn dials so the brain is a tiny bit
     more likely to do them next time.
   - Actions that scored poorly → turn dials so it's a tiny bit
     less likely.

4. Do step 3 a few times on the same tape, then throw the tape away.

5. Send the (now slightly smarter) brain back into the gym.
   Repeat ~10,000 times.
```

## Coach + player analogy

> **The brain is a player learning to play soccer.**
>
> Each *rollout* = one practice session. Player runs, takes shots,
> makes passes. You film everything.
>
> *Computing advantages* = a coach reviewing the film and marking
> each move with "good" or "bad."
>
> Each *gradient step* = the coach telling the player "next time,
> lean a bit more to the left when you pass." Tiny technique
> adjustment.
>
> An *epoch* = the coach watches the same film a second time,
> catches more things, gives more tiny tips.
>
> The *clip* = "don't change your whole style in one session.
> Small adjustments only."
>
> Next practice, the slightly-improved player plays again. Coach
> films it. Cycle.

The math behind the coach's clipboard is in libraries you'll
import, not write. The intuition above is the part you carry
around.

---

# Part 1: Math refresh

You're not going to do calculus or linear algebra by hand. You will
read code and papers that use the symbols casually. Let's make sure
the symbols don't trip you up.

## Scalars, vectors, matrices, tensors

| name | what it is | how it looks |
|---|---|---|
| **scalar** | a single number | `7` |
| **vector** | a list of numbers | `[3.2, -1.0, 0.7]` |
| **matrix** | a grid of numbers | `[[1,2],[3,4]]` |
| **tensor** | any number of dimensions | shapes like `(64, 48, 3)` or `(4096, 300)` |

In code: numpy `array`, PyTorch `Tensor`. Same thing.

For a robot:

- The chassis pose `(x, y, yaw)` is a **vector** of length 3.
- A depth image at 64×48 is a **matrix** of shape `(48, 64)`.
- A batch of 4,096 such images is a **tensor** of shape
  `(4096, 48, 64)`.

That's it. Tensors are just multi-dimensional arrays. The word
"tensor" sounds intimidating in physics because it means something
deeper there. In ML it almost always just means "ndarray."

## Vector and matrix multiplication, gently

### Dot product (vector · vector)

Take two vectors of the same length. Multiply them element by
element. Add up the results. You get a single number.

```
   a = [1, 2, 3]
   b = [4, 5, 6]

   a · b = 1·4 + 2·5 + 3·6 = 4 + 10 + 18 = 32
```

That's it. The dot product measures "how aligned are these two
vectors." When two vectors point the same way, their dot product
is big. When they're perpendicular, it's zero.

### Matrix-vector multiplication

A matrix is just a stack of row vectors. Multiplying a matrix by a
vector means: take the dot product of each row with that vector.
You get a new vector, one number per row.

```
   matrix M =     vector v =     result M·v =
   [ 1  2  3 ]    [ 1 ]          [ 1·1 + 2·2 + 3·3 ]   [ 14 ]
   [ 4  5  6 ]    [ 2 ]    →     [ 4·1 + 5·2 + 6·3 ] = [ 32 ]
   [ 7  8  9 ]    [ 3 ]          [ 7·1 + 8·2 + 9·3 ]   [ 50 ]
```

In code: `M @ v` (Python's matmul operator).

This is the single most important operation in deep learning.
**A neural-net layer is, fundamentally, a matrix-vector
multiplication followed by a nonlinear function.** When someone
says "matmul," they mean this.

### Matrix-matrix multiplication

Same idea, but the right-hand side is also a matrix. You take each
row of the left matrix and dot it with each column of the right
matrix. Result is a new matrix.

You don't need to remember the rule. You need to remember the
shape rule:

```
   (m × k)  @  (k × n)  =  (m × n)
   "rows-by-cols     "rows-by-cols     result has rows from
    of first"         of second"        first, cols from second
```

The inner numbers must match (`k` and `k`). The outer numbers tell
you the result shape.

Example: in a batched neural net, we multiply a `(4096, 300)`
matrix of observations by a `(300, 64)` matrix of weights to get a
`(4096, 64)` output. **The same operation runs on all 4096
observations at once. That's why GPUs are good at this.**

### Why "linear algebra" matters for ML

Every operation inside a neural network — every layer, every
forward pass, every gradient — is *some* mix of matrix
multiplications, element-wise functions, and reductions (sums and
maxes). That's the whole vocabulary. Once you've seen the
matrix-vector pattern, everything else is a variation.

## Derivatives, intuitively

A **derivative** of a function tells you how fast the function is
changing. The slope.

### Single-variable

If `y = 3x`, then `y` changes by 3 every time `x` changes by 1. The
derivative is `3`.

If `y = x²`, the slope depends on where you are. At `x=1`, a small
change in x makes y change by ~2. At `x=10`, the same change makes
y change by ~20. The derivative is `2x` — a function, not a number.

What you actually need to remember:

| function | derivative |
|---|---|
| constant `c` | `0` |
| `x` | `1` |
| `x²` | `2x` |
| `xⁿ` | `n · xⁿ⁻¹` |
| `e^x` | `e^x` (this one is magical) |
| `ln(x)` | `1/x` |
| `sin(x)` | `cos(x)` |

You will not compute derivatives by hand. PyTorch / JAX do it for
you (this is called **autodiff** — automatic differentiation). But
you should know what they *represent*: how much does the output
change when the input nudges?

### Multi-variable: gradients

When a function has many inputs (`f(x, y, z, …)`), you can take
the derivative *with respect to each one separately*. Those
"partial derivatives" packed into a vector are called the
**gradient**.

```
   if f = 3x² + 2y,

   ∂f/∂x = 6x      (slope along x)
   ∂f/∂y = 2       (slope along y)

   gradient ∇f = [6x, 2]
```

The gradient is a vector that **points in the direction of
fastest increase**. If you want to *decrease* the function, go in
the opposite direction. That single insight is the whole core of
neural-net training.

### Chain rule (the heart of backprop)

You will never have to derive this — autodiff does it. But it's
worth knowing what it says.

If you have nested functions — `output = g(f(x))` — and you want to
know how `output` changes when `x` nudges, you multiply the
derivatives along the chain:

```
   d(output) / d(x)  =  g'(f(x))  ·  f'(x)
```

In English: how the output changes per change in x =
(how output changes per change in f's value) × (how f's value
changes per change in x).

A neural net is a stack of nested functions:

```
   output  =  layer_5( layer_4( layer_3( layer_2( layer_1( input ))))) 
```

To figure out how the output changes when a weight in `layer_1`
nudges, you multiply all the derivatives from `layer_5` backward
to `layer_1`. That's **backpropagation**. It's just the chain rule
applied to a deep stack.

### How much of this do you really need?

You need:

- To *read* `gradient`, `loss.backward()`, `optimizer.step()` and
  know roughly what's happening.
- To know that **gradients point uphill, training goes downhill**.
- To know that **derivatives compose along the chain rule, and
  that's why backprop walks backward through the network.**

You do not need to:

- Derive the chain rule
- Hand-compute the gradient of softmax
- Remember the Jacobian. (It's a matrix of partial derivatives. You will
  see this word; nod and move on.)

---

# Part 2: How a neural net actually works

Now we put the pieces together.

## What a neural net actually is

A neural net is **a function** that takes a vector in, runs it
through a chain of layers, and produces a vector out. Each layer is
a matrix multiply followed by a nonlinearity.

The whole structure of a tiny 3-layer net:

```
   input x  ─┐
             │   layer 1:    h₁ = relu( W₁ · x  + b₁ )
             │   layer 2:    h₂ = relu( W₂ · h₁ + b₂ )
             │   layer 3:    y  =       W₃ · h₂ + b₃
   output y ─┘
```

- `W₁, W₂, W₃` are weight matrices (the dials)
- `b₁, b₂, b₃` are bias vectors (more dials)
- `relu(z) = max(0, z)` — kill the negatives, keep the positives. A
  cheap nonlinearity.
- `h₁, h₂` are hidden activations — what the middle layers compute

If you stripped out the `relu`, the whole thing would collapse into
one big linear function (because matmul of matmuls is just
another matmul). The nonlinearity is what gives the network
expressive power. Without it, no amount of stacking matters.

That's the entire architecture of a basic MLP (multi-layer
perceptron). All neural nets are variations on this — bigger,
different layer types, different connection patterns, but the
matmul + nonlinearity core is everywhere.

## The forward pass

Run the input through the network. Get an output. That's a forward
pass. Cheap. One matmul per layer.

For a robot policy:

- Input: observation vector (depth image flattened + pose + goal)
- Layers: a few matmuls with nonlinearities
- Output: the action vector (e.g., two wheel velocities)

The brain decides what to do by running one forward pass per tick.

## The loss

After the forward pass, you compare the output to what you wanted.
The **loss** is a single number measuring "how wrong was that?"

In supervised learning (image classification):

```
   loss = (predicted_label - true_label)²        ← MSE loss
   loss = -log(probability_of_correct_class)     ← cross-entropy loss
```

In RL (what we use):

```
   loss = the PPO objective we described
        = − (advantage × clipped probability ratio)
```

The actual formula doesn't matter for the intuition. What matters:
**lower loss = brain is doing better**. We want to nudge the
weights to make the loss smaller.

## Backpropagation (in pictures)

Now the magic. We have a loss, computed from the forward pass. We
want to know: *for each weight in the network, how much would
nudging it change the loss?*

That answer for every weight is the **gradient of the loss with
respect to the weights**. Once we have it, we know which way to
turn each dial.

```
   forward pass:  input → layer1 → layer2 → layer3 → loss
                   ─────────────────────────────────────▶

   backward pass: input ← layer1 ← layer2 ← layer3 ← loss
                  ◀─────────────────────────────────────
                  gradient flows from the end of the network
                  backward, computing how much each weight
                  contributed to the loss
```

The math is just the chain rule. The implementation is autodiff.
You write the forward pass; PyTorch / JAX builds the backward pass
for free.

## Gradient descent (the dial-turning algorithm)

Now you have, for every weight, a number saying "if you increased
me, the loss would go up by this much." So:

- Weights with positive gradient → turn them DOWN (to lower loss)
- Weights with negative gradient → turn them UP

In code:

```python
weight = weight - learning_rate * gradient
```

`learning_rate` is a small number (`0.0003` is typical). It
controls how big each nudge is. Too big → overshoot, training
diverges. Too small → training takes forever.

Repeat for every weight. That's one **gradient step**. Repeat for
millions of steps. That's training.

Variations you'll hear:

- **SGD (stochastic gradient descent)**: the baseline. Use a
  random minibatch to estimate the gradient. Cheap, noisy.
- **Adam**: smarter version of SGD with per-weight learning rates
  and momentum. The default optimizer in ~90% of modern deep
  learning.
- **AdamW**: Adam plus a tiny correction for weight decay.
  Currently the most-common default in large models.

You will write `optimizer = torch.optim.Adam(...)` and never look
inside. Knowing it exists is enough.

## Batch sizes, minibatches, epochs (revisited with math)

Now you have the vocabulary:

- **Batch**: a tensor of inputs you process together. Shape
  `(batch_size, input_dim)`.
- **Minibatch**: in big training runs, your full dataset doesn't
  fit in memory. You split it into smaller batches called
  minibatches. Process one at a time.
- **Epoch**: one pass through all minibatches.
- **Iteration / step**: one gradient step on one minibatch.

For PPO with Yard-ish numbers:

```
   rollout size: 131,072 tuples
   minibatch size: 8,192
   epochs per rollout: 4
   ────────────────────────────────
   total gradient steps per rollout = (131,072 / 8,192) × 4 = 64
```

Big-picture intuition: the brain takes 64 small steps per
rollout, then collects a new rollout with the updated brain, then
takes 64 more, …

---

# Part 3: The model families

You'll hear architectures named in every paper and demo. Here's
the field, in seven cards.

## 1. MLP (multi-layer perceptron)

The thing in Part 2. A stack of matmul-and-nonlinearity layers.

- **Eats:** flat vector in
- **Spits:** flat vector out
- **Inside:** a few dense layers, ReLU between them
- **When you use it:** the policy network in our diff-drive bot
  would be this. Tiny, fast, simple. Robotics policies of the
  ~100k-parameter scale are almost always MLPs.

When someone says "the policy is a 3-layer MLP," they mean
something with maybe 100k–1M parameters arranged in three of these
stacks. Nothing exotic.

## 2. CNN (convolutional neural network)

For images. Instead of treating an image as a flat vector of
pixels (which would be huge and ignore spatial structure), you
slide a small filter across the image computing local matmuls.

```
       image (48 × 64)              small filter (3 × 3)
       ┌─────────────────────┐      ┌────┐
       │                     │  →   │    │   slides across the image,
       │     ...pixels...    │      │    │   computing local features
       │                     │      └────┘
       └─────────────────────┘
```

Each filter "looks for" some pattern (an edge, a corner, a
texture). The network learns thousands of these filters. Early
layers find edges; deeper layers find more complex patterns.

- **Eats:** image tensor `(C, H, W)`
- **Spits:** feature tensor or label
- **Inside:** convolution layers, ReLU, sometimes pooling, then a
  few dense layers at the end
- **When you use it:** any time you need to compress an image into
  features for downstream use. Robot vision encoders, depth
  processors.

Famous examples: ResNet (image classification), YOLO (object
detection). Both still used in robotics for perception.

## 3. RNN / LSTM

For sequences. Has a hidden state that gets passed forward in time.

```
   t=1:   input₁ → cell → hidden₁ → output₁
                          │
                          ▼
   t=2:   input₂ → cell → hidden₂ → output₂
                          │
                          ▼
   t=3:   input₃ → cell → hidden₃ → output₃
```

The cell is shared across timesteps. Its hidden state carries
information forward (e.g., "what was the bot doing 0.5 seconds
ago?").

- **LSTM** (long short-term memory): an RNN variant with gates
  controlling what to remember, what to forget.
- **GRU** (gated recurrent unit): a slightly simpler LSTM.

Largely *replaced* by transformers in 2020–2023, but you'll still
see them in some robotics codebases.

## 4. Transformer

The dominant deep-learning architecture as of 2026. Eats sequences.

The key trick: **attention.** Instead of passing a single hidden
state forward through time (RNN-style), every element of the
sequence can look at every other element and decide what to focus
on.

Diagram of one attention layer:

```
   sequence of tokens
   ┌───┐  ┌───┐  ┌───┐  ┌───┐  ┌───┐
   │ a │  │ b │  │ c │  │ d │  │ e │
   └─┬─┘  └─┬─┘  └─┬─┘  └─┬─┘  └─┬─┘
     │      │      │      │      │
     ▼      ▼      ▼      ▼      ▼
   each token computes:
     "how relevant is every other token to me?"
     → produces "attention weights" over the sequence
     → outputs a weighted sum of all the tokens
   ┌───┐  ┌───┐  ┌───┐  ┌───┐  ┌───┐
   │ a'│  │ b'│  │ c'│  │ d'│  │ e'│   ← refined tokens
   └───┘  └───┘  └───┘  └───┘  └───┘
```

Stack many of these layers and you get a transformer. **All modern
LLMs are transformers.** All modern VLMs are transformers with an
image-encoder on the front.

- **Eats:** sequence of tokens (words, image patches, time steps)
- **Spits:** sequence of refined tokens, or one prediction
- **Inside:** attention layers + MLPs, layer-norm sprinkled in
- **When you use it:** any task with long-range structure. Text,
  multi-frame video, multi-step robot trajectories.

The math has one key formula you'll see:

```
   attention(Q, K, V) = softmax(Q · Kᵀ / √d) · V
```

You don't need to remember it. You should know that **softmax**
turns numbers into probabilities (always positive, sum to 1), and
the whole thing means "weight each value V by how well each query
Q matches each key K." That's it.

## 5. Diffusion model

Generative model. Used in image generation (Stable Diffusion,
DALL-E) and now in robot policies (diffusion policy).

The idea: start with pure random noise, and step by step *denoise*
it into a coherent output. The network is trained to predict "how
to remove a small amount of noise from this thing."

```
   pure noise → slightly denoised → less noisy → … → clean output
                  (50 steps of denoising)
```

For robot policies: instead of generating an image, generate a
**trajectory** — a sequence of actions over the next ~1 second.
Start with random actions, denoise into a coherent plan.

- **Eats:** random noise + conditioning (image, language prompt)
- **Spits:** clean trajectory or image
- **Inside:** a transformer or CNN that predicts the noise at each
  denoising step
- **When you use it:** when you want stable, multi-modal outputs.
  Diffusion policies are smoother than MLP policies and handle
  "many right answers" gracefully (a fork can be picked up many
  ways).

Toyota Research's "Large Behavior Models" and Physical
Intelligence's π0 are diffusion-policy at their core. Becoming
standard for manipulation in 2025–2026.

## 6. VLA (Vision-Language-Action)

The newest hotness. A foundation model that:

- Takes in **camera images** + **a text instruction**
- Spits out **actions** for the robot

Architecturally: it's a transformer pretrained on web-scale
vision-language data (like an LLM with eyes), then fine-tuned on
robot teleop data to produce action tokens.

```
   "fold the laundry"   ──┐
                          │
   ┌─────────┐            │       ┌──────────────┐
   │ camera  │ ──────────▶│ VLA   │ → action     │
   │ images  │            │ model │   tokens     │
   └─────────┘            │       │  → robot     │
                          │       └──────────────┘
                          │
   robot state  ──────────┘
```

Examples in the wild:
- **Helix** (Figure)
- **π0 / π0.5** (Physical Intelligence)
- **RT-2** (Google)
- **GR00T** (NVIDIA)
- **OpenVLA** (open-source academic)

VLAs are the answer to "how do we make robots general-purpose?"
The bet: pretrain on huge web data, fine-tune on smaller robot
data, get something that can follow language commands across many
robot bodies and many tasks. Whether this scales as well as it
does for LLMs is still being proven.

## 7. World model

A neural net that learns to *predict the future*. Given the
current observation and a candidate action, predict what the next
observation will be.

```
   (obs_t, action_t)  →  world model  →  predicted obs_{t+1}
```

Used in two ways:

- **Planning**: roll out futures inside the world model instead of
  the real sim. Useful when sim is expensive.
- **Imagination**: train the policy partly on imagined experience.
  Dreamer (DeepMind) is the canonical work.

Less common in production robotics today, but rising.

---

# Part 4: The physics the sim is solving

Time for the physics half. Don't sweat the equations; we'll keep
them light.

## Newton's three laws (refresh)

You learned these in high school. Quick anchors:

1. **A body at rest stays at rest unless a force acts on it.**
   "Things don't move on their own."
2. **F = m·a.** Force on a body equals its mass times its
   acceleration. The single most important formula in mechanics.
3. **Every action has an equal and opposite reaction.** When the
   robot's wheel pushes on the ground, the ground pushes back on
   the wheel with the same magnitude in the opposite direction.

For rotation, there's a rotational analogue:

```
   linear:    F = m · a
   rotation:  τ = I · α

   F  = force          τ  = torque
   m  = mass           I  = moment of inertia (rotational mass)
   a  = acceleration   α  = angular acceleration
```

Same shape, just rotational versions. You don't need to remember
the formulas — you need to recognize them when MuJoCo logs them.

## What a "rigid body" is

A rigid body = an object that doesn't deform under force. Boxes,
wheels, robot chassis. In sim, every rigid body has:

- **mass** `m` (a scalar, in kg)
- **inertia tensor** `I` (a 3×3 matrix capturing how mass is
  distributed — affects how it resists rotation)
- **pose**: position `(x, y, z)` + orientation (a quaternion or
  matrix)
- **velocity**: linear `(vₓ, vᵧ, v_z)` + angular `(ωₓ, ωᵧ, ω_z)`

That's 13 numbers per body (3+4+3+3). For a humanoid with 30
bodies, the full state is ~400 numbers. Tiny. That's why thousands
of envs fit on a GPU.

## Inertia, intuitively

For linear motion: heavy things are harder to start and stop.

For rotation: same idea, but it depends on *how the mass is
distributed*. A solid sphere and a hollow shell with the same
total mass have different rotational inertia. A figure skater with
their arms in spins faster than one with arms extended.

The inertia tensor encodes all this. Don't memorize the formulas;
know that it's there and that getting it wrong (in MJCF) is the
single most common cause of "the robot mysteriously flies away."

## Joints and degrees of freedom

A **joint** constrains how one body moves relative to another.

| joint | what it does | DOF |
|---|---|---|
| **fixed** | rigid attachment, no motion | 0 |
| **hinge / revolute** | one axis of rotation | 1 |
| **slide / prismatic** | one axis of translation | 1 |
| **ball / spherical** | three axes of rotation | 3 |
| **free** | unconstrained, floats in 3D | 6 |

A 6-DOF robot arm has six revolute joints; the end-effector can
reach any position + orientation (subject to range limits). A
diff-drive robot's chassis has 6 DOF (it can in principle slide and
rotate freely in 3D); we anchor it to the floor via gravity +
wheel contacts.

## Forces and torques

In the sim, three kinds of forces act on each body:

1. **Gravity.** Constant downward force `m · g` where g ≈ 9.81 m/s²
   on Earth.
2. **Actuator forces.** What the motors apply via the joints.
3. **Contact forces.** What's transmitted between bodies that are
   touching.

The physics engine's job each tick: figure out all three for every
body, sum them, divide by mass to get acceleration, integrate to
get new velocities + positions.

## Contact and friction

The hard part of rigid-body sim is **contact**: when two bodies
touch, the engine has to compute "how much force is being
transmitted through the contact patch?" — and do it without letting
the bodies penetrate each other.

The model used everywhere:

```
   normal force: pushes bodies apart, keeps them from penetrating
                 (a constraint, not just a function of distance)

   friction force: acts tangent to the contact surface
                   magnitude ≤ μ · normal_force
                   (Coulomb friction model)
```

The friction coefficient μ is what you'll see in MJCF. `μ = 0.6`
for our wheels means the tangential force can be at most 60% of
the normal force before slipping.

Real-life friction isn't this clean (it depends on speed,
temperature, surface texture), but the Coulomb model is what every
engine implements because it's close enough.

## Numerical integration — why dt matters

Physics in continuous time is "velocity is the derivative of
position; acceleration is the derivative of velocity; solve the
differential equation." We can't do that perfectly in real time.
We approximate with **discrete steps**.

The simplest method (explicit Euler):

```
   each tick of duration dt:
       accel = force / mass
       vel   = vel + accel · dt
       pos   = pos + vel · dt
```

This is what we use in head. Easy. But it's **wrong** in subtle
ways:

- If `dt` is too big, fast-moving objects can tunnel through walls
  before the engine notices the contact.
- Stiff systems (springs, motors, contact constraints) "explode" —
  the simulation blows up to infinity within a few steps.

Better integrators:

- **RK4** (Runge-Kutta 4th order): take four sub-steps per tick,
  combine. More accurate. ~4× the cost per tick.
- **Implicit Euler**: instead of "apply the force you have *now*,"
  solve for "what velocity at the *next* step is consistent with
  the dynamics?" Requires solving a system of equations per tick.
  Slower per tick but rock-solid stable. **MuJoCo's default.**

What you actually need to know: **`dt = 5ms` is fine for most
robots; `dt = 50ms` is asking for trouble.** If your robot blows
up, halve `dt` and try again before suspecting anything else.

## Stiff systems — the word "stiff"

You will hear "stiff." It means: the system has very fast modes
(things that change quickly relative to dt). Contacts are stiff
(normal force jumps from 0 to huge in one tick). Springs are stiff
when their k is high. Motors are stiff when their gain is high.

Explicit integrators (like Euler) need tiny dt for stiff systems
or they blow up. Implicit integrators handle stiffness gracefully.
This is why MuJoCo defaults to implicit Euler.

That's the whole reason your physics engine survives running your
robot. You don't have to do anything; just know that's what's
happening behind the scenes.

## Quaternions in one paragraph

You'll see them everywhere. Quaternions are 4 numbers `(w, x, y,
z)` that encode a 3D rotation more cleanly than Euler angles
(roll/pitch/yaw) — no gimbal lock, no ambiguity. The math behind
them is hairy. The practical takeaway: when you see `qpos[3:7]`
in our `sim.py`, those are the four quaternion components of the
chassis orientation. We extract yaw from them with one line of
`atan2`. Treat quaternions as a black box; you'll never do
quaternion algebra in your day-to-day.

---

# Part 5: Actuators

Actuators are what makes robots move. They convert electrical or
hydraulic energy into mechanical motion. The choice of actuator
shapes everything else — speed, force, weight, control bandwidth,
safety.

## DC motors — the workhorse

A brushed or brushless DC motor: apply voltage, the rotor spins,
torque is roughly proportional to the current it pulls. Cheap,
well-understood, in 90% of robots.

- **Torque**: `τ = K_t · I` (proportional to current)
- **Back-EMF**: spinning produces a voltage that opposes the
  applied voltage (`V_back = K_e · ω`)
- **Steady-state speed**: voltage = back-EMF, no acceleration
  (ω_max = V / K_e)

Brushed motors have carbon brushes that wear out. Brushless DC
(BLDC) motors are the modern default — no brushes, last longer,
controlled by an inverter (a small computer that schedules current
to the windings).

You will not design motors. You will read specs and pick one.

## Gear reductions

Raw DC motors spin fast (thousands of RPM) at low torque. Robots
typically need the opposite: slow motion at high torque.
**Gear reductions** trade speed for torque.

Trade-off: torque goes up, speed goes down, both by the gear
ratio.

```
   gear ratio N:1   →   torque ×N,  speed ÷N,  efficiency ~95%
```

A 100:1 reduction turns a 10,000-RPM, 1-Nm motor into a 100-RPM,
~95-Nm joint.

## Harmonic drives

A specialty gearbox: zero backlash, very high reduction ratio (50:1
to 200:1) in a compact disk. Used in nearly every industrial robot
arm and most humanoid arms.

```
   harmonic drive parts:
     - wave generator (elliptical, spins with the motor)
     - flexspline    (thin metal cup that deforms)
     - circular spline (rigid outer ring with internal teeth)

   the wave generator deforms the flexspline so its teeth
   engage the circular spline in two zones; as it rotates,
   the flexspline rotates much more slowly in the opposite
   direction (high reduction, no backlash).
```

Why everyone uses them: **no backlash.** When you reverse the
input, the output reverses immediately — no "play" between teeth.
Crucial for precision robots.

Downside: they're expensive ($500–$3000 per joint), and the
flexspline wears out after 10,000+ hours of duty cycle.

## Cycloidal drives

Same goal (zero-backlash, high reduction), different mechanism.
Often used at higher-torque joints. Robomaster / Unitree use these.
Cheaper than harmonic; bulkier.

## Planetary gearboxes

The cheap, robust option. Multiple smaller gears (planets)
orbiting a central gear (sun) inside a ring gear. Higher backlash
than harmonic/cycloidal, but tough and cheap. Found in legged
robot joints where backlash matters less.

## Tendon drives (the 1X choice)

Instead of putting motors at each joint, mount big motors in the
torso and route cables (tendons) through the limbs. The motors
pull the tendons; the tendons move the joints.

Pros:
- Limbs are light and have low inertia (motors aren't out there)
- The system is naturally compliant — cables stretch under load,
  acting like a built-in soft spring. Safer near humans.

Cons:
- Routing is mechanically complex
- Cables wear out
- Harder to model precisely

This is the actuation choice that defines 1X's NEO. Compliance is
the safety story for a home robot.

## Hydraulic actuators (legacy)

Pump pressurized fluid through pistons to apply huge forces.
**Boston Dynamics' Atlas was hydraulic** until 2024. Massive force
density. Loud, heavy, leak-prone, expensive to engineer.

Pretty much extinct in new humanoid designs. Atlas itself went
electric.

## Pneumatic / Series-Elastic / SEA

Series-elastic actuator: a spring placed between the motor and
the joint. Lets you sense torque cheaply (measure spring
deflection). Used in some research humanoids and Agility's Digit.

Pneumatic: compressed air. Used mostly in industrial grippers, not
humanoids.

## Cheat sheet

| actuator | force/torque density | speed | backlash | cost | who uses |
|---|---|---|---|---|---|
| DC + planetary | medium | high | medium | low | hobby / cheap robots |
| DC + harmonic | high | medium | ≈0 | high | industrial arms, Figure |
| DC + cycloidal | very high | medium | low | medium | Unitree, some legged robots |
| Tendon-driven | medium | medium | depends on routing | medium | 1X |
| Hydraulic | very high | medium | ≈0 | very high | legacy Atlas |
| SEA | medium | medium | ≈0 + compliant | medium | research, Agility Digit |

What you say in a conversation: *"They're using brushless DC motors
with harmonic drives at every joint."* That's a description of
~half of all humanoid robots.

---

# Part 6: Sensors

Sensors are how the robot perceives. Like actuators, the choice
shapes everything downstream.

## Joint encoders

Sense joint angles. The simplest, most reliable, most informative
sensor on a robot. Two kinds:

- **Incremental**: counts ticks as the joint moves; needs to find
  "home" each power cycle. Cheap.
- **Absolute**: knows its position without homing. Magnetic
  rotary encoders (AS5048, AS5600, MA730) are the modern default.

Resolution: 12-bit (4,096 positions per revolution) is standard;
high-end uses 20-bit. After the gear reduction, this gives
sub-arcminute precision at the joint.

How it works (absolute magnetic): a small magnet on the shaft, a
sensor chip below measures the magnetic field direction. The chip
outputs the angle directly over I²C or SPI.

```
   joint angle → encoder → digital number (e.g., 0..4095)
                                     ↓
                              every motor controller
                              has this in its loop
```

You will never hand-tune an encoder. You read its number off a bus.

## IMU (Inertial Measurement Unit)

Three sensors usually packaged together:

| sensor | measures | unit |
|---|---|---|
| **accelerometer** | linear acceleration along x, y, z | m/s² |
| **gyroscope** | angular velocity around x, y, z | rad/s |
| **magnetometer** | direction of Earth's magnetic field | (vector) |

Used together to estimate the robot's orientation in 3D and
detect motion. **Every robot has at least one IMU on the torso.**

The math:

- Accelerometer: under gravity, when you're stationary, this
  reads `(0, 0, -9.81)` in world frame. Reading deviations tells
  you which way is "down" → you can extract roll and pitch.
- Gyroscope: integrates angular velocity over time to track
  orientation. Drifts (gyro bias accumulates).
- Sensor fusion: combine accelerometer (no drift, noisy) +
  gyroscope (low noise, drifts) with a Kalman filter to get a
  robust orientation estimate.

In the sim: MuJoCo gives you ground-truth orientation directly.
You don't need to fuse anything. In the real world, fusing IMU
data is its own subfield (read about "AHRS" — Attitude and Heading
Reference Systems).

## Cameras (RGB)

Image sensors. Same hardware as a webcam, often:

- **CMOS sensor**: a grid of millions of light-sensitive cells.
  Each cell counts photons over an exposure time → a number per
  pixel.
- **Color filter array (Bayer)**: each cell has a red, green, or
  blue filter; the image processor interpolates to get full RGB.
- **Output**: an `(H, W, 3)` tensor of integers 0..255 (or 0..65535
  for higher-bit-depth sensors).

For robots: 30–60 fps, 640×480 to 1080p resolutions. Higher
resolution = more compute downstream, lower fps = jerkier control.

The "math" is mostly geometry — given a 3D point in the world,
where does it project to in the image plane? That's a `3×4` matrix
multiply involving the camera's **intrinsic** parameters (focal
length, principal point) and **extrinsic** parameters (its pose in
the world).

## Depth cameras

Like RGB but with a depth value per pixel — how far away is what
this pixel is looking at? Three flavors:

| type | how it works | range | when used |
|---|---|---|---|
| **Stereo** | two RGB cameras side by side; triangulate from disparity | 0.3–10 m | cheap, no extra hardware |
| **Structured light** | project a known IR pattern; observe how it deforms | 0.2–3 m | indoor, short range. Old Kinect. |
| **Time-of-flight (ToF)** | emit IR pulse, measure how long it takes to return | 0.3–10 m | iPhone LiDAR scanner; some robot cameras |

The Yard sensor we simulated is a **synthetic depth camera** —
MuJoCo's offscreen renderer gives us the perfect ground-truth
depth that real cameras only approximate.

## LiDAR

LiDAR = Light Detection And Ranging. Same idea as ToF depth
camera, but with a focused laser that scans the environment in a
pattern.

- **2D LiDAR**: one rotating laser, gives a slice (typically a
  circle in the horizontal plane). Common in vacuum robots, AGVs.
- **3D LiDAR**: multiple lasers in a stack, rotating together, or
  a flash array. Gives a 3D point cloud. Used in autonomous cars,
  Agility Digit.

Output: a list of `(x, y, z)` points — typically 100k–2M points per
scan. Much more spatial coverage than a depth camera but heavier
processing.

Note: Tesla famously does *not* use LiDAR (camera-only philosophy).
Boston Dynamics, Agility, and most autonomous cars do.

## Force / torque sensors

Six-axis force-torque sensors at the wrist (or each joint)
measure the actual force and torque being applied. Essential for
contact-rich tasks (manipulation, polishing, assembly).

Inside: strain gauges that deform under load, producing a tiny
resistance change. Bridge circuits amplify; ADC digitizes.

The output is six numbers: three force components `(Fₓ, Fᵧ, F_z)`
and three torque components `(τₓ, τᵧ, τ_z)`. Calibration is
delicate — temperature, mounting stress, and gravity bias affect
the readings.

## Tactile sensors

The newest area. Skin-like sensor arrays that detect pressure (and
sometimes vibration, temperature) across a surface. Examples:

- **GelSight**: a soft gel pad with a camera underneath; the gel
  deforms under contact, the camera sees the deformation, you
  reconstruct the contact patch with high resolution.
- **Capacitive arrays**: grids of capacitor cells that change
  capacitance under pressure. Used in some humanoid hands.
- **Piezoresistive**: pressure-sensitive material whose resistance
  changes. Robust but lower resolution.

Used by Figure, Tesla, and most serious humanoid hands. Crucial
for delicate manipulation (eggs, fabric, soft objects).

## Microphones, GPS, IR proximity, etc.

Less common in current humanoids, but you'll see them in specific
contexts:

- **Microphone arrays** for voice + sound localization
- **GPS** for outdoor robots
- **IR proximity** for "is something within 5 cm?" detection
- **RGB-D in one package** (Intel RealSense, Orbbec) bundles RGB
  + depth + IMU in a single $200 sensor

## Cheat sheet

| sensor | gives you | typical noise / gotcha |
|---|---|---|
| Joint encoder | joint angle | basically perfect, just always there |
| Accelerometer | linear accel | gravity bias, vibration noise |
| Gyroscope | angular vel | bias drifts over seconds |
| Magnetometer | compass heading | indoor distortion |
| RGB camera | image | exposure, motion blur, lighting changes |
| Depth (stereo) | per-pixel depth | poor on textureless surfaces |
| Depth (ToF) | per-pixel depth | multipath errors, shiny surfaces |
| LiDAR | point cloud | dropouts on dark / reflective surfaces |
| Force-torque | wrench at a joint | drift, temperature sensitive |
| Tactile | contact map | wear, hard to calibrate |

What to say in a conversation: *"It has a 6-DOF IMU on the torso,
joint encoders at every joint, two RGB cameras for stereo depth,
plus tactile pads on the fingertips."* That's a typical humanoid
sensor suite.

---

# Part 7: A full humanoid, end-to-end

Putting all of it together, here's roughly what's actually inside
a humanoid like Figure 02 or Tesla Optimus:

## The hardware stack

```
   ┌─────────────────────────────────────────────────────────────┐
   │  Robot body                                                  │
   │                                                              │
   │  Sensors                  Compute                Actuators   │
   │  ─────────                ─────────              ─────────   │
   │  • IMU (torso)            • Main GPU             • Brushless │
   │  • Joint encoders         • Real-time CPU         DC motors  │
   │    (×30+ joints)          • Vision encoder        + harmonic │
   │  • 2-4 RGB cameras          accelerator           drives at  │
   │  • Depth cam (1-2)        • Motor controllers     every joint│
   │  • Tactile sensors          (one per joint)      • Tendon    │
   │    on fingertips                                  drives in  │
   │  • F/T at wrists                                  fingers    │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                            (control loop)
                                  │
   ┌──────────────────────────────▼──────────────────────────────┐
   │  Brain (multi-layered)                                       │
   │                                                              │
   │  Slow layer (5-10 Hz):  Vision-Language-Action model         │
   │                         "given image+task, what's the high-  │
   │                          level plan?"                        │
   │                                                              │
   │  Fast layer (50-200 Hz): policy network (MLP or transformer) │
   │                          "given state, what's the next       │
   │                           action?"                           │
   │                                                              │
   │  Low layer (1000 Hz):    classical joint controller          │
   │                          "given desired joint position,      │
   │                           apply torque to track it"          │
   └─────────────────────────────────────────────────────────────┘
```

Three control rates because each layer needs different speeds:

- **VLA at 5 Hz** is fine because language plans don't change
  every millisecond.
- **Policy at 100 Hz** is fast enough to balance and react.
- **Joint control at 1 kHz** is fast enough to track torques
  precisely (the underlying motor electronics need this rate).

## The training stack

From Yard's perspective, what we built is the gym half:

```
   Yard (gym)                Training infrastructure       Brain
   ─────────                 ───────────────────────       ─────

   MJCF + MuJoCo  →  GPU-batched sim (4096 envs)  →  rollout buffer
                                                          │
                                                          ▼
                                                      PPO algorithm
                                                          │
                                                          ▼
                                                      brain weights
                                                          │
                                                  (one nudge per step)
                                                          │
                                                          ▼
                                                      back into sim
```

After training: deploy the brain to the real robot. Hope sim-to-real
transfer holds. If not: domain randomization, system identification,
fine-tuning on real data.

That's the whole field. Everything you'll read about — VLAs,
diffusion policies, MJX, Isaac Lab, GR00T, Helix, π0 — is some
variation on this picture.

You now know enough to read a paper, sit in a meeting, and ask
sensible follow-up questions. Welcome aboard.

---

# Appendix: quick-recall cards

If you forget any of this, here's the densest possible version:

## Math

- **Vector** = list of numbers
- **Matrix** = grid of numbers
- **Tensor** = nd-array
- **Dot product** = element-wise multiply, sum the results
- **Matmul** = stack of dot products; the workhorse of deep learning
- **Derivative** = slope of a function
- **Gradient** = vector of slopes for a multi-input function
- **Chain rule** = derivatives compose along nested functions; this
  is why backprop works

## Neural nets

- A net is a stack of `relu(W·x + b)` layers
- **Forward pass** = compute the output
- **Loss** = scalar measuring how wrong the output is
- **Backprop** = chain-rule the gradient back through all layers
- **Gradient descent** = `weights -= lr · gradient`
- **Optimizer** (Adam): a smarter SGD

## Model families

- **MLP**: vector in, vector out, dense layers
- **CNN**: image in, features out
- **Transformer**: sequence in, sequence out, attention
- **Diffusion**: denoise random noise into clean output
- **VLA**: vision + language → action
- **World model**: predict next state given action

## Physics

- `F = m·a` (linear), `τ = I·α` (rotational)
- A rigid body has mass, inertia, pose, velocity
- Joint = constraint between two bodies
- Contact = normal force + Coulomb friction
- Numerical integration: take small `dt` steps; implicit Euler is
  the safe default

## Actuators

- DC motor + harmonic drive = standard humanoid joint
- Tendon drives = compliant (1X)
- SEA = built-in spring for sensing (Digit, research)

## Sensors

- Joint encoder = always there, ground truth on angles
- IMU = accel + gyro + magnetometer → orientation
- Camera = image; depth camera adds distance
- LiDAR = 3D point cloud
- F/T = forces at a joint
- Tactile = pressure on skin

This is the vocabulary. The rest is reps.
