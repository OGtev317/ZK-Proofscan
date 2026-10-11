// The smallest useful test circuit: knows a and b with a * b = c.
// b and c are public; a is private.
fn main(a: Field, b: pub Field) -> pub Field {
    a * b
}
