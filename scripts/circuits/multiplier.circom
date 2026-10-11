pragma circom 2.0.0;

// The smallest useful test circuit: knows a and b with a * b = c.
// c and b are public; a is private.
template Multiplier() {
    signal input a;
    signal input b;
    signal output c;
    c <== a * b;
}

component main {public [b]} = Multiplier();
